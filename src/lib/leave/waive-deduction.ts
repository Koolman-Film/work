'use server';

import { headers } from 'next/headers';
import { auditLogTx } from '@/lib/audit/log';
import { canActOnEmployeeBranches, getPermittedBranches } from '@/lib/auth/branch-scope';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma, prismaRaw } from '@/lib/db/prisma';
import { computeLiveLeaveCharges } from './recompute';

export type WaiveResult = { ok: true } | { ok: false; message: string };

async function reqMeta() {
  const h = await headers();
  return {
    ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? undefined,
    userAgent: h.get('user-agent') ?? undefined,
  };
}

/**
 * Forgive some or all of the over-quota deduction on ONE leave request.
 *
 * `overQuotaMinutes` is deliberately left alone. The employee really was that
 * far beyond quota and the record should keep saying so; what changes is how
 * much of it the company chooses to charge. Both facts then sit side by side in
 * the row and in the audit entry, which is the point — "forgave 61 days,
 * because X" is a very different statement from a deduction that quietly
 * shrank.
 *
 * Minutes, not baht: the deduction is derived on read at the employee's current
 * per-minute rate (leave/recompute.ts), so a waiver stored in baht would drift
 * the moment their salary changed. `replayOverQuota` applies the waiver to the
 * CHARGE only — never to quota consumption — so forgiving one request can never
 * make a later one cheaper.
 *
 * Guards, in the order they run:
 *   1. branch scope BEFORE any state-specific error, so an out-of-branch admin
 *      cannot learn a request's existence or paid state from which message
 *      comes back (same ordering as void.ts and correct-type.ts);
 *   2. already swept into a published payroll → refused. The money is frozen
 *      and reversing it is the multi-table surgery in
 *      docs/runbooks/penalty-settled-with-leave.md, not a waiver;
 *   3. a reason is required — an unexplained forgiveness of salary is exactly
 *      what an audit trail exists to prevent.
 */
export async function waiveLeaveDeduction(input: {
  leaveRequestId: string;
  /** Minutes to forgive. Clamped to the request's actual over-quota. 0 removes
   *  an existing waiver, which is how a mistaken one is undone. */
  waiveMinutes: number;
  reason: string;
}): Promise<WaiveResult> {
  const reason = input.reason?.trim() ?? '';
  if (!reason) return { ok: false, message: 'กรุณาระบุเหตุผล' };
  if (!Number.isFinite(input.waiveMinutes) || input.waiveMinutes < 0) {
    return { ok: false, message: 'จำนวนนาทีไม่ถูกต้อง' };
  }

  const { user } = await requirePermission('leave.waive-deduction');
  const permitted = await getPermittedBranches(user, 'leave.waive-deduction');

  const req = await prismaRaw.leaveRequest.findUnique({
    where: { id: input.leaveRequestId },
    select: {
      id: true,
      employeeId: true,
      status: true,
      deletedAt: true,
      deductedInPayrollId: true,
      overQuotaMinutes: true,
      waivedOverQuotaMinutes: true,
      waiveReason: true,
      employee: { select: { branchId: true, assignedBranchIds: true } },
    },
  });
  if (!req || req.deletedAt) return { ok: false, message: 'ไม่พบคำขอลา' };

  const employeeBranchIds = [req.employee.branchId, ...req.employee.assignedBranchIds];
  if (!canActOnEmployeeBranches(permitted, employeeBranchIds)) {
    return { ok: false, message: 'ไม่พบคำขอลา' };
  }

  if (req.status !== 'Approved') {
    return { ok: false, message: 'ยกเว้นได้เฉพาะคำขอที่อนุมัติแล้ว' };
  }
  if (req.deductedInPayrollId != null) {
    return { ok: false, message: 'จ่ายแล้ว — แก้ไขไม่ได้' };
  }

  // Clamp against the LIVE over-quota, not the stored column.
  //
  // `LeaveRequest.overQuotaMinutes` is only frozen when a payroll publishes;
  // until then it is null or stale, because over-quota is derived on read from
  // the current entitlement (leave/recompute.ts). Clamping against the stored
  // value silently pinned every waiver on an unpublished request to 0 — which
  // is exactly the request an admin needs to waive.
  //
  // Clamping rather than erroring keeps "waive all of it" expressible without
  // the admin having to know the exact minute figure.
  const live = (await computeLiveLeaveCharges([req.employeeId])).find(
    (c) => c.leaveRequestId === input.leaveRequestId,
  );
  const over = live?.overQuotaMinutes ?? req.overQuotaMinutes ?? 0;
  const waive = Math.min(Math.floor(input.waiveMinutes), over);

  try {
    await prisma.$transaction(async (tx) => {
      // Re-assert the unpaid state in the WHERE rather than trusting the read
      // above: a payroll publish could have swept this row in between, and that
      // freezes the money. One atomic statement, no gap.
      const { count } = await tx.leaveRequest.updateMany({
        where: { id: input.leaveRequestId, deductedInPayrollId: null, deletedAt: null },
        data: {
          waivedOverQuotaMinutes: waive,
          waiveReason: waive > 0 ? reason : null,
          waivedAt: waive > 0 ? new Date() : null,
          waivedById: waive > 0 ? user.id : null,
        },
      });
      if (count === 0) throw new Error('STALE');

      await auditLogTx(tx, {
        actorId: user.id,
        action: 'leave.waive-deduction',
        entityType: 'LeaveRequest',
        entityId: input.leaveRequestId,
        before: {
          waivedOverQuotaMinutes: req.waivedOverQuotaMinutes,
          waiveReason: req.waiveReason,
        },
        after: {
          waivedOverQuotaMinutes: waive,
          waiveReason: waive > 0 ? reason : null,
          // Kept alongside so the entry is readable on its own: how far over
          // quota the request was, and therefore what share was forgiven.
          overQuotaMinutes: over,
          requestedMinutes: input.waiveMinutes,
        },
        metadata: { ...(await reqMeta()), source: 'admin-ui' },
      });
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof Error && err.message === 'STALE') {
      return { ok: false, message: 'สถานะเปลี่ยนไประหว่างดำเนินการ — กรุณาเปิดใหม่' };
    }
    console.error('[waiveLeaveDeduction] failed', err);
    return { ok: false, message: 'ระบบขัดข้อง กรุณาลองใหม่' };
  }
}
