'use server';

import { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auditLog } from '@/lib/audit/log';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { readForm } from './adjustment-schema';

/**
 * PayrollAdjustment (เงินเพิ่ม/เงินลด) CRUD actions.
 *
 * Gated by `payroll.run` — entering adjustments is part of preparing a
 * payroll run, so it shares that permission rather than introducing a new
 * key (which would need a RoleDefinition backfill migration).
 *
 * Delete is a soft-delete (deletedAt) — already-published months keep
 * their frozen numbers either way (selection happens at calc time), but
 * soft-delete keeps the row inspectable for audit follow-ups.
 */

const LIST = '/admin/payroll/adjustments';

export async function createAdjustment(formData: FormData) {
  const { user } = await requirePermission('payroll.run');

  const parsed = readForm(formData);
  if (!parsed.success) {
    redirect(`${LIST}/new?error=${encodeURIComponent(parsed.error)}`);
  }
  const data = parsed.data;

  const created = await prisma.payrollAdjustment.create({
    data: {
      employeeId: data.employeeId,
      kind: data.kind,
      reason: data.reason,
      amount: new Prisma.Decimal(data.amount),
      startMonth: data.startMonth,
      endMonth: data.endMonth,
      note: data.note,
    },
  });
  auditLog({
    actorId: user.id,
    action: 'payrollAdjustment.create',
    entityType: 'PayrollAdjustment',
    entityId: created.id,
    after: { ...data },
    metadata: { source: 'admin-ui' },
  });

  revalidatePath(LIST);
  revalidatePath('/admin/payroll');
  redirect(LIST);
}

export async function updateAdjustment(id: string, formData: FormData) {
  const { user } = await requirePermission('payroll.run');

  const parsed = readForm(formData);
  if (!parsed.success) {
    redirect(`${LIST}/${id}?error=${encodeURIComponent(parsed.error)}`);
  }
  const data = parsed.data;

  const before = await prisma.payrollAdjustment.findUnique({ where: { id } });
  if (!before || before.deletedAt) redirect(LIST);

  await prisma.payrollAdjustment.update({
    where: { id },
    data: {
      employeeId: data.employeeId,
      kind: data.kind,
      reason: data.reason,
      amount: new Prisma.Decimal(data.amount),
      startMonth: data.startMonth,
      endMonth: data.endMonth,
      note: data.note,
    },
  });
  auditLog({
    actorId: user.id,
    action: 'payrollAdjustment.edit',
    entityType: 'PayrollAdjustment',
    entityId: id,
    before: {
      employeeId: before.employeeId,
      kind: before.kind,
      reason: before.reason,
      amount: before.amount.toString(),
      startMonth: before.startMonth,
      endMonth: before.endMonth,
      note: before.note,
    },
    after: { ...data },
    metadata: { source: 'admin-ui' },
  });

  revalidatePath(LIST);
  revalidatePath('/admin/payroll');
  redirect(LIST);
}

/**
 * Soft-delete behind the edit page's ConfirmDialog. Returns an
 * ActionResult instead of redirecting — the client wrapper navigates back
 * to the list on success.
 */
export async function deleteAdjustment(
  id: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { user } = await requirePermission('payroll.run');

  const before = await prisma.payrollAdjustment.findUnique({ where: { id } });
  if (!before || before.deletedAt) return { ok: false, message: 'ไม่พบรายการ' };

  await prisma.payrollAdjustment.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
  auditLog({
    actorId: user.id,
    action: 'payrollAdjustment.delete',
    entityType: 'PayrollAdjustment',
    entityId: id,
    before: {
      employeeId: before.employeeId,
      kind: before.kind,
      reason: before.reason,
      amount: before.amount.toString(),
      startMonth: before.startMonth,
      endMonth: before.endMonth,
    },
    metadata: { source: 'admin-ui' },
  });

  revalidatePath(LIST);
  revalidatePath('/admin/payroll');
  return { ok: true };
}
