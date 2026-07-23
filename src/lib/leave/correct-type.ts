'use server';

import { Prisma } from '@prisma/client';
import { headers } from 'next/headers';
import { auditLogTx } from '@/lib/audit/log';
import {
  canActOnEmployeeBranches,
  getPermittedBranches,
  type PermittedBranches,
} from '@/lib/auth/branch-scope';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma, prismaRaw } from '@/lib/db/prisma';
import {
  type CorrectionRipple,
  computeCorrectionRipple,
  type RippleRequest,
} from './correct-type-core';
import { getLeaveConfig } from './leave-config';
import { perMinuteRate, type ReplayEntitlement } from './over-quota';
import { penaltyMinutesBy } from './penalty-minutes';
import { standardDayMinutes } from './units';

export type CorrectionPreview =
  | { ok: true; ripple: CorrectionRipple; oldTypeName: string; newTypeName: string }
  | { ok: false; message: string };

type Ctx = {
  ripple: CorrectionRipple;
  oldTypeName: string;
  newTypeName: string;
};

async function reqMeta() {
  const h = await headers();
  return {
    ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? undefined,
    userAgent: h.get('user-agent') ?? undefined,
  };
}

const YEAR_MS = (y: number) => ({
  gte: new Date(Date.UTC(y, 0, 1)),
  lt: new Date(Date.UTC(y + 1, 0, 1)),
});

const REQ_SELECT = {
  id: true,
  chargedMinutes: true,
  overQuotaMinutes: true,
  deductAmount: true,
  reviewedAt: true,
  createdAt: true,
  deductedInPayrollId: true,
} as const;

/** Shared loader for both preview and apply. Returns a machine-readable error
 *  code as a string in the `error` field, or the fully-computed context. */
async function loadCorrectionContext(
  leaveRequestId: string,
  newLeaveTypeId: string,
  permitted: PermittedBranches,
): Promise<{ error: string } | Ctx> {
  const req = await prismaRaw.leaveRequest.findUnique({
    where: { id: leaveRequestId },
    select: {
      id: true,
      employeeId: true,
      leaveTypeId: true,
      startDate: true,
      status: true,
      deletedAt: true,
      deductedInPayrollId: true,
      reviewedAt: true,
      createdAt: true,
      chargedMinutes: true,
      overQuotaMinutes: true,
      deductAmount: true,
      leaveType: { select: { name: true, overQuotaPolicy: true, annualQuota: true } },
      employee: {
        select: { salaryType: true, baseSalary: true, branchId: true, assignedBranchIds: true },
      },
    },
  });
  if (!req || req.deletedAt) return { error: 'ไม่พบคำขอลา' };

  // Branch-scope check MUST happen before any state-specific guard below —
  // otherwise an out-of-branch admin could learn a request's existence,
  // paid-state, or policy from which error comes back. Matches void.ts.
  const employeeBranchIds = [req.employee.branchId, ...req.employee.assignedBranchIds];
  if (!canActOnEmployeeBranches(permitted, employeeBranchIds)) return { error: 'ไม่พบคำขอลา' };

  if (req.status !== 'Approved') return { error: 'แก้ประเภทได้เฉพาะคำขอที่อนุมัติแล้ว' };
  if (req.deductedInPayrollId != null) return { error: 'จ่ายแล้ว — แก้ไขไม่ได้' };
  if (req.leaveType.overQuotaPolicy !== 'DeductPay') return { error: 'ประเภทเดิมไม่รองรับการแก้' };
  if (newLeaveTypeId === req.leaveTypeId) return { error: 'ประเภทใหม่ต้องต่างจากเดิม' };

  const newType = await prisma.leaveType.findUnique({
    where: { id: newLeaveTypeId },
    select: { name: true, overQuotaPolicy: true, annualQuota: true },
  });
  if (!newType) return { error: 'ไม่พบประเภทที่เลือก' };
  if (newType.overQuotaPolicy !== 'DeductPay') return { error: 'ประเภทที่เลือกไม่รองรับการแก้' };

  const cfg = await getLeaveConfig();
  const std = standardDayMinutes(cfg);
  const payCfg = await prisma.payrollConfig.findFirstOrThrow({
    select: { workingDaysPerMonth: true },
  });
  const year = req.startDate.getUTCFullYear();

  const [oldRows, newRows, oldEntRow, newEntRow, penalties] = await Promise.all([
    prisma.leaveRequest.findMany({
      where: {
        employeeId: req.employeeId,
        leaveTypeId: req.leaveTypeId,
        status: 'Approved',
        deletedAt: null,
        startDate: YEAR_MS(year),
      },
      select: REQ_SELECT,
    }),
    prisma.leaveRequest.findMany({
      where: {
        employeeId: req.employeeId,
        leaveTypeId: newLeaveTypeId,
        status: 'Approved',
        deletedAt: null,
        startDate: YEAR_MS(year),
      },
      select: REQ_SELECT,
    }),
    prisma.leaveEntitlement.findUnique({
      where: {
        employeeId_leaveTypeId_periodYear: {
          employeeId: req.employeeId,
          leaveTypeId: req.leaveTypeId,
          periodYear: year,
        },
      },
      select: { grantedMinutes: true, carryoverMinutes: true, adjustmentMinutes: true },
    }),
    prisma.leaveEntitlement.findUnique({
      where: {
        employeeId_leaveTypeId_periodYear: {
          employeeId: req.employeeId,
          leaveTypeId: newLeaveTypeId,
          periodYear: year,
        },
      },
      select: { grantedMinutes: true, carryoverMinutes: true, adjustmentMinutes: true },
    }),
    penaltyMinutesBy([req.employeeId], year),
  ]);

  const toRipple = (r: (typeof oldRows)[number]): RippleRequest => ({
    id: r.id,
    chargedMinutes: r.chargedMinutes ?? 0,
    reviewedAtMs: (r.reviewedAt ?? r.createdAt).getTime(),
    swept: r.deductedInPayrollId != null,
    curOverQuotaMinutes: r.overQuotaMinutes ?? 0,
    curDeductAmount: r.deductAmount == null ? null : Number(r.deductAmount),
  });

  // The moved request must appear in oldGroup (computeCorrectionRipple requires
  // it). It normally arrives there via the oldRows query (its leaveTypeId is
  // still the old type at read time), but we don't rely on that — build it
  // directly from the already-loaded `req` and de-dupe against oldRows so the
  // moved row is present exactly once regardless of query/mock behavior.
  const movedAsOldRow: (typeof oldRows)[number] = {
    id: req.id,
    chargedMinutes: req.chargedMinutes,
    overQuotaMinutes: req.overQuotaMinutes,
    deductAmount: req.deductAmount,
    reviewedAt: req.reviewedAt,
    createdAt: req.createdAt,
    deductedInPayrollId: req.deductedInPayrollId,
  };

  const grantedFallback = (
    entRow: { grantedMinutes: number | null } | null,
    quota: number | null,
  ) => (entRow ? entRow.grantedMinutes : quota == null ? null : quota * std);
  const oldEnt: ReplayEntitlement = {
    grantedMinutes: grantedFallback(oldEntRow, req.leaveType.annualQuota),
    carryoverMinutes: oldEntRow?.carryoverMinutes ?? 0,
    adjustmentMinutes: oldEntRow?.adjustmentMinutes ?? 0,
    penaltyMinutes: penalties.get(`${req.employeeId}:${req.leaveTypeId}`) ?? 0,
  };
  const newEnt: ReplayEntitlement = {
    grantedMinutes: grantedFallback(newEntRow, newType.annualQuota),
    carryoverMinutes: newEntRow?.carryoverMinutes ?? 0,
    adjustmentMinutes: newEntRow?.adjustmentMinutes ?? 0,
    penaltyMinutes: penalties.get(`${req.employeeId}:${newLeaveTypeId}`) ?? 0,
  };

  const rate = perMinuteRate(
    req.employee.salaryType,
    Number(req.employee.baseSalary),
    payCfg.workingDaysPerMonth,
    std,
  );
  const ripple = computeCorrectionRipple({
    movedRequestId: req.id,
    oldGroup: [movedAsOldRow, ...oldRows.filter((r) => r.id !== req.id)].map(toRipple),
    newGroup: newRows.filter((r) => r.id !== req.id).map(toRipple),
    oldEnt,
    newEnt,
    ratePerMin: rate,
  });

  return {
    ripple,
    oldTypeName: req.leaveType.name,
    newTypeName: newType.name,
  };
}

export async function previewLeaveTypeCorrection(
  leaveRequestId: string,
  newLeaveTypeId: string,
): Promise<CorrectionPreview> {
  const { user } = await requirePermission('leave.correct-type');
  const permitted = await getPermittedBranches(user, 'leave.correct-type');
  const ctx = await loadCorrectionContext(leaveRequestId, newLeaveTypeId, permitted);
  if ('error' in ctx) return { ok: false, message: ctx.error };
  return {
    ok: true,
    ripple: ctx.ripple,
    oldTypeName: ctx.oldTypeName,
    newTypeName: ctx.newTypeName,
  };
}

export async function correctLeaveType(input: {
  leaveRequestId: string;
  newLeaveTypeId: string;
  note: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const note = input.note?.trim() ?? '';
  if (!note) return { ok: false, message: 'กรุณาระบุเหตุผล' };

  const { user } = await requirePermission('leave.correct-type');
  const permitted = await getPermittedBranches(user, 'leave.correct-type');
  const ctx = await loadCorrectionContext(input.leaveRequestId, input.newLeaveTypeId, permitted);
  if ('error' in ctx) return { ok: false, message: ctx.error };

  const meta = await reqMeta();
  const { ripple, oldTypeName, newTypeName } = ctx;
  try {
    await prisma.$transaction(async (tx) => {
      // Re-check paid/deleted state INSIDE the transaction (the state loaded
      // for the preview may be stale by the time this runs). Folded into the
      // moved request's own update via an extended `where` rather than a
      // separate findUnique-then-update: the check and the write happen as
      // one atomic statement, so there is no gap between "verified unpaid"
      // and "wrote the new type" for a concurrent payroll sweep to land in.
      // Prisma raises P2025 ("no record matched") when the extra where
      // clauses fail to match, which we translate to the STALE guard below.
      try {
        await tx.leaveRequest.update({
          where: { id: input.leaveRequestId, deductedInPayrollId: null, deletedAt: null },
          data: {
            leaveTypeId: input.newLeaveTypeId,
            overQuotaMinutes: ripple.moved.overQuotaMinutes,
            deductAmount: ripple.moved.deductAmount,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
          throw new Error('STALE');
        }
        throw err;
      }
      // Unswept siblings whose split shifted.
      for (const w of ripple.siblingWrites) {
        await tx.leaveRequest.update({
          where: { id: w.id },
          data: { overQuotaMinutes: w.overQuotaMinutes, deductAmount: w.deductAmount },
        });
      }
      await auditLogTx(tx, {
        actorId: user.id,
        action: 'leave.correct-type',
        entityType: 'LeaveRequest',
        entityId: input.leaveRequestId,
        before: { leaveType: oldTypeName } as unknown as Prisma.JsonValue,
        after: {
          leaveType: newTypeName,
          note,
          netDeductDelta: ripple.netDeductDelta,
          rows: ripple.displayRows,
        } as unknown as Prisma.JsonValue,
        metadata: { ...meta, source: 'admin-ui' },
      });
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof Error && err.message === 'STALE') {
      return { ok: false, message: 'สถานะเปลี่ยนไประหว่างดำเนินการ — กรุณาเปิดใหม่' };
    }
    console.error('[correctLeaveType] failed', err);
    return { ok: false, message: 'ระบบขัดข้อง กรุณาลองใหม่' };
  }
}
