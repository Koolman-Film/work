'use server';

import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { payrollPeriodFor } from '@/lib/advance/period-earnings';
import { auditLogTx, type Prisma } from '@/lib/audit/log';
import { canActOnEmployeeBranches, getPermittedBranches } from '@/lib/auth/branch-scope';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma, prismaRaw } from '@/lib/db/prisma';
import { monthLabelTh } from '@/lib/format';

export type VoidResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | 'not-found'
        | 'forbidden'
        | 'already-voided'
        | 'reason-required'
        | 'settlement-closed'
        | 'error';
      message: string;
    };

async function reqMeta() {
  const h = await headers();
  return {
    ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? undefined,
    userAgent: h.get('user-agent') ?? undefined,
  };
}

/**
 * Soft-delete (void) a single Attendance row. Branch-scoped: the actor must
 * hold attendance.void for THIS employee's branch. Once voided, the row frees
 * its (employeeId, date, type) slot via the partial unique index, so the
 * correct row can be re-entered.
 */
export async function voidAttendance(id: string, reason: string): Promise<VoidResult> {
  const trimmed = reason?.trim() ?? '';
  if (!trimmed) return { ok: false, code: 'reason-required', message: 'กรุณาระบุเหตุผล' };

  // prismaRaw: we must SEE the row even if (defensively) already voided.
  const row = await prismaRaw.attendance.findUnique({
    where: { id },
    select: {
      id: true,
      deletedAt: true,
      employeeId: true,
      date: true,
      employee: { select: { branchId: true, assignedBranchIds: true } },
    },
  });
  if (!row) return { ok: false, code: 'not-found', message: 'ไม่พบรายการลงเวลา' };
  if (row.deletedAt) return { ok: false, code: 'already-voided', message: 'รายการนี้ถูกลบไปแล้ว' };

  const { user } = await requirePermission('attendance.void');
  const permitted = await getPermittedBranches(user, 'attendance.void');
  if (
    !canActOnEmployeeBranches(permitted, [row.employee.branchId, ...row.employee.assignedBranchIds])
  )
    notFound();

  // Defect 1 (merge blocker): voiding a row whose payroll month already
  // carries a LIVE penalty settlement, once that month has left Draft, would
  // permanently strand the settlement — money is frozen at publish
  // (isPeriodClosed, penalty-settlement-admin.ts) but this void would drop
  // the actual penalty count straight to zero, and clearPenaltySettlement
  // refuses a closed period forever. Derives the row's payroll month with
  // the SAME cutoff-day arithmetic the manual attendance form and the
  // advance cap use (payrollPeriodFor, advance/period-earnings.ts) rather
  // than re-deriving it — see that module's doc-comment.
  //
  // Conservative on purpose: this checks for ANY live settlement in the
  // row's payroll month for this employee, not only one whose `kind`
  // matches this row's attendance type — mirroring how the publish-time
  // stranded guard (run.ts) and setPenaltySettlement's own guards are also
  // employee+month scoped rather than trying to prove a causal link between
  // one attendance row and one settlement kind.
  //
  // While the month is still Draft, the void is allowed: the admin can then
  // fix the settlement on the reconcile page, and if they forget,
  // publishPayroll's own stranded-settlement guard (run.ts) catches it
  // before the month is ever frozen.
  const payrollCfg = await prisma.payrollConfig.findFirst({ select: { cutoffDay: true } });
  if (payrollCfg) {
    const dateYmd = row.date.toISOString().slice(0, 10);
    const month = payrollPeriodFor(dateYmd, payrollCfg.cutoffDay).end.slice(0, 7);

    const liveSettlement = await prisma.attendancePenaltySettlement.findFirst({
      where: { employeeId: row.employeeId, month, deletedAt: null },
      select: { id: true },
    });
    if (liveSettlement) {
      const closed = await prisma.payroll.findFirst({
        where: { employeeId: row.employeeId, month, status: { not: 'Draft' } },
        select: { id: true },
      });
      if (closed) {
        return {
          ok: false,
          code: 'settlement-closed',
          message: `ไม่สามารถลบรายการนี้ได้ — ปิดรอบเงินเดือน${monthLabelTh(month)}ไปแล้ว และเดือนนี้มีการหักสิทธิวันลาชดเชยค่าปรับอยู่ จึงไม่สามารถปรับสิทธิคืนได้อีก`,
        };
      }
    }
  }

  const meta = await reqMeta();

  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.attendance.findUnique({ where: { id } });
      await tx.attendance.update({
        where: { id },
        data: { deletedAt: new Date(), deletedById: user.id, deleteReason: trimmed },
      });
      await auditLogTx(tx, {
        actorId: user.id,
        action: 'attendance.void',
        entityType: 'Attendance',
        entityId: id,
        before: before as unknown as Prisma.JsonValue,
        after: { deletedById: user.id, deleteReason: trimmed },
        metadata: { ...meta, source: 'admin-ui' },
      });
    });
    return { ok: true };
  } catch (err) {
    console.error('[voidAttendance] failed', err);
    return { ok: false, code: 'error', message: 'ระบบขัดข้อง กรุณาลองใหม่' };
  }
}

/**
 * Restore a voided Attendance row. Refuses if the (employeeId, date, type) slot
 * has since been re-filled by a live row — restoring would violate the partial
 * unique index, so we fail with a clear message instead of a raw DB error.
 */
export async function restoreAttendance(id: string): Promise<VoidResult> {
  const row = await prismaRaw.attendance.findUnique({
    where: { id },
    select: {
      id: true,
      deletedAt: true,
      employeeId: true,
      date: true,
      type: true,
      employee: { select: { branchId: true, assignedBranchIds: true } },
    },
  });
  if (!row) return { ok: false, code: 'not-found', message: 'ไม่พบรายการลงเวลา' };
  if (!row.deletedAt) return { ok: true }; // already live — idempotent

  const { user } = await requirePermission('attendance.void');
  const permitted = await getPermittedBranches(user, 'attendance.void');
  if (
    !canActOnEmployeeBranches(permitted, [row.employee.branchId, ...row.employee.assignedBranchIds])
  )
    notFound();

  // The slot may have been re-filled while this row was voided.
  const live = await prismaRaw.attendance.findFirst({
    where: { employeeId: row.employeeId, date: row.date, type: row.type, deletedAt: null },
    select: { id: true },
  });
  if (live) {
    return {
      ok: false,
      code: 'error',
      message: 'กู้คืนไม่ได้ — มีรายการที่ถูกต้องสำหรับวันและประเภทนี้อยู่แล้ว',
    };
  }

  const meta = await reqMeta();
  try {
    await prisma.$transaction(async (tx) => {
      await tx.attendance.update({
        where: { id },
        data: { deletedAt: null, deletedById: null, deleteReason: null },
      });
      await auditLogTx(tx, {
        actorId: user.id,
        action: 'attendance.restore',
        entityType: 'Attendance',
        entityId: id,
        metadata: { ...meta, source: 'admin-ui' },
      });
    });
    return { ok: true };
  } catch (err) {
    // Covers the TOCTOU race: a concurrent insert could fill the slot between
    // the pre-check above and this commit, tripping the partial unique index.
    console.error('[restoreAttendance] failed', err);
    return {
      ok: false,
      code: 'error',
      message: 'กู้คืนไม่ได้ — มีรายการที่ถูกต้องสำหรับวันและประเภทนี้อยู่แล้ว',
    };
  }
}
