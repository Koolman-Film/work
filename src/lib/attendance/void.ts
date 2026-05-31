'use server';

import { headers } from 'next/headers';
import { auditLogTx, type Prisma } from '@/lib/audit/log';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma, prismaRaw } from '@/lib/db/prisma';

export type VoidResult =
  | { ok: true }
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
    select: { id: true, deletedAt: true, employee: { select: { branchId: true } } },
  });
  if (!row) return { ok: false, code: 'not-found', message: 'ไม่พบรายการลงเวลา' };
  if (row.deletedAt) return { ok: false, code: 'already-voided', message: 'รายการนี้ถูกลบไปแล้ว' };

  const { user } = await requirePermission('attendance.void', { branchId: row.employee.branchId });
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
      employee: { select: { branchId: true } },
    },
  });
  if (!row) return { ok: false, code: 'not-found', message: 'ไม่พบรายการลงเวลา' };
  if (!row.deletedAt) return { ok: true }; // already live — idempotent

  const { user } = await requirePermission('attendance.void', { branchId: row.employee.branchId });

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
}
