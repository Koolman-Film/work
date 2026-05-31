'use server';

import { headers } from 'next/headers';
import { auditLogTx, type Prisma } from '@/lib/audit/log';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma, prismaRaw } from '@/lib/db/prisma';
import { assertAdvanceVoidable } from './void-guards';

export type VoidResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | 'not-found'
        | 'forbidden'
        | 'already-voided'
        | 'already-deducted'
        | 'reason-required'
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
 * Soft-delete (void) a CashAdvance. Refuses if the advance was already consumed
 * by a published payroll (isDeducted=true) — see assertAdvanceVoidable. Branch-
 * scoped via the employee's branch.
 */
export async function voidCashAdvance(id: string, reason: string): Promise<VoidResult> {
  const trimmed = reason?.trim() ?? '';
  if (!trimmed) return { ok: false, code: 'reason-required', message: 'กรุณาระบุเหตุผล' };

  const row = await prismaRaw.cashAdvance.findUnique({
    where: { id },
    select: {
      id: true,
      deletedAt: true,
      isDeducted: true,
      status: true,
      employee: { select: { branchId: true } },
    },
  });
  if (!row) return { ok: false, code: 'not-found', message: 'ไม่พบคำขอเบิก' };

  const guard = assertAdvanceVoidable({ isDeducted: row.isDeducted, deletedAt: row.deletedAt });
  if (!guard.ok) return { ok: false, code: guard.code, message: guard.message };

  const { user } = await requirePermission('advance.void', { branchId: row.employee.branchId });
  const meta = await reqMeta();

  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.cashAdvance.findUnique({ where: { id } });
      await tx.cashAdvance.update({
        where: { id },
        data: { deletedAt: new Date(), deletedById: user.id, deleteReason: trimmed },
      });
      await auditLogTx(tx, {
        actorId: user.id,
        action: 'advance.void',
        entityType: 'CashAdvance',
        entityId: id,
        before: before as unknown as Prisma.JsonValue,
        after: { deletedById: user.id, deleteReason: trimmed },
        metadata: { ...meta, source: 'admin-ui' },
      });
    });
    return { ok: true };
  } catch (err) {
    console.error('[voidCashAdvance] failed', err);
    return { ok: false, code: 'error', message: 'ระบบขัดข้อง กรุณาลองใหม่' };
  }
}

/**
 * Restore a voided CashAdvance. No slot/unique concerns here (CashAdvance has
 * no partial unique index), so a simple un-void + audit.
 */
export async function restoreCashAdvance(id: string): Promise<VoidResult> {
  const row = await prismaRaw.cashAdvance.findUnique({
    where: { id },
    select: { id: true, deletedAt: true, employee: { select: { branchId: true } } },
  });
  if (!row) return { ok: false, code: 'not-found', message: 'ไม่พบคำขอเบิก' };
  if (!row.deletedAt) return { ok: true };

  const { user } = await requirePermission('advance.void', { branchId: row.employee.branchId });
  const meta = await reqMeta();
  try {
    await prisma.$transaction(async (tx) => {
      await tx.cashAdvance.update({
        where: { id },
        data: { deletedAt: null, deletedById: null, deleteReason: null },
      });
      await auditLogTx(tx, {
        actorId: user.id,
        action: 'advance.restore',
        entityType: 'CashAdvance',
        entityId: id,
        metadata: { ...meta, source: 'admin-ui' },
      });
    });
    return { ok: true };
  } catch (err) {
    console.error('[restoreCashAdvance] failed', err);
    return { ok: false, code: 'error', message: 'ระบบขัดข้อง กรุณาลองใหม่' };
  }
}
