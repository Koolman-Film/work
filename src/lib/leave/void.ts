'use server';

import { headers } from 'next/headers';
import { auditLogTx, type Prisma } from '@/lib/audit/log';
import { canActOnEmployeeBranches, getPermittedBranches } from '@/lib/auth/branch-scope';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma, prismaRaw } from '@/lib/db/prisma';

export type VoidResult =
  | { ok: true; voidedAttendanceCount?: number }
  | {
      ok: false;
      code: 'not-found' | 'forbidden' | 'already-voided' | 'reason-required' | 'error';
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
 * Soft-delete (void) a LeaveRequest. CASCADE: an approved leave isn't just one
 * row — approval generated N Attendance(OnLeave) rows (see lib/leave/admin.ts).
 * Voiding the parent alone would orphan those rows and corrupt payroll, so we
 * void them in the same transaction, tagged `leave.void:<id>` so restore can
 * find exactly the rows this void removed. The full generated set is snapshotted
 * into the audit `before` for forensic recovery.
 */
export async function voidLeaveRequest(id: string, reason: string): Promise<VoidResult> {
  const trimmed = reason?.trim() ?? '';
  if (!trimmed) return { ok: false, code: 'reason-required', message: 'กรุณาระบุเหตุผล' };

  const row = await prismaRaw.leaveRequest.findUnique({
    where: { id },
    select: {
      id: true,
      deletedAt: true,
      status: true,
      employee: { select: { branchId: true, assignedBranchIds: true } },
    },
  });
  if (!row) return { ok: false, code: 'not-found', message: 'ไม่พบคำขอลา' };
  if (row.deletedAt) return { ok: false, code: 'already-voided', message: 'คำขอนี้ถูกลบไปแล้ว' };

  const { user } = await requirePermission('leave.void');
  const permitted = await getPermittedBranches(user, 'leave.void');
  if (
    !canActOnEmployeeBranches(permitted, [row.employee.branchId, ...row.employee.assignedBranchIds])
  ) {
    return { ok: false, code: 'not-found', message: 'ไม่พบคำขอลา' };
  }
  const meta = await reqMeta();
  const now = new Date();

  try {
    let voidedAttendanceCount = 0;
    await prisma.$transaction(async (tx) => {
      // Cascade: void the generated OnLeave attendance rows. Snapshot them into
      // the audit `before` so restore can recreate exactly (spec §10).
      const generated = await tx.attendance.findMany({
        where: { leaveRequestId: id, deletedAt: null },
      });
      if (generated.length > 0) {
        await tx.attendance.updateMany({
          where: { leaveRequestId: id, deletedAt: null },
          data: { deletedAt: now, deletedById: user.id, deleteReason: `leave.void:${id}` },
        });
        voidedAttendanceCount = generated.length;
      }
      await tx.leaveRequest.update({
        where: { id },
        data: { deletedAt: now, deletedById: user.id, deleteReason: trimmed },
      });
      await auditLogTx(tx, {
        actorId: user.id,
        action: 'leave.void',
        entityType: 'LeaveRequest',
        entityId: id,
        before: {
          status: row.status,
          generatedAttendance: generated,
        } as unknown as Prisma.JsonValue,
        after: { deletedById: user.id, deleteReason: trimmed, voidedAttendanceCount },
        metadata: { ...meta, source: 'admin-ui' },
      });
    });
    return { ok: true, voidedAttendanceCount };
  } catch (err) {
    console.error('[voidLeaveRequest] failed', err);
    return { ok: false, code: 'error', message: 'ระบบขัดข้อง กรุณาลองใหม่' };
  }
}

/**
 * Restore a voided LeaveRequest and the Attendance(OnLeave) rows the void
 * cascaded over (matched by the `leave.void:<id>` tag).
 */
export async function restoreLeaveRequest(id: string): Promise<VoidResult> {
  const row = await prismaRaw.leaveRequest.findUnique({
    where: { id },
    select: {
      id: true,
      deletedAt: true,
      employee: { select: { branchId: true, assignedBranchIds: true } },
    },
  });
  if (!row) return { ok: false, code: 'not-found', message: 'ไม่พบคำขอลา' };
  if (!row.deletedAt) return { ok: true };

  const { user } = await requirePermission('leave.void');
  const permitted = await getPermittedBranches(user, 'leave.void');
  if (
    !canActOnEmployeeBranches(permitted, [row.employee.branchId, ...row.employee.assignedBranchIds])
  ) {
    return { ok: false, code: 'not-found', message: 'ไม่พบคำขอลา' };
  }
  const meta = await reqMeta();

  try {
    await prisma.$transaction(async (tx) => {
      await tx.leaveRequest.update({
        where: { id },
        data: { deletedAt: null, deletedById: null, deleteReason: null },
      });
      // Restore the cascade-voided attendance rows tagged with this leave id.
      // If a live OnLeave row re-filled one of these (employeeId, date, type)
      // slots while the leave was voided, this hits the partial unique index
      // and the whole transaction rolls back — we surface a clear message
      // rather than a raw 500.
      await tx.attendance.updateMany({
        where: { leaveRequestId: id, deleteReason: `leave.void:${id}` },
        data: { deletedAt: null, deletedById: null, deleteReason: null },
      });
      await auditLogTx(tx, {
        actorId: user.id,
        action: 'leave.restore',
        entityType: 'LeaveRequest',
        entityId: id,
        metadata: { ...meta, source: 'admin-ui' },
      });
    });
    return { ok: true };
  } catch (err) {
    console.error('[restoreLeaveRequest] failed', err);
    return {
      ok: false,
      code: 'error',
      message: 'กู้คืนไม่ได้ — อาจมีรายการลงเวลาที่ทับซ้อนกับวันลานี้แล้ว',
    };
  }
}
