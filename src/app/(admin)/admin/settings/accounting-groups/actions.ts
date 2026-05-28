'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { auditLog } from '@/lib/audit/log';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';

const Schema = z.object({
  name: z.string().trim().min(1, 'กรุณากรอกชื่อกลุ่ม').max(80),
  peakCode: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((s) => (s ? s : null)),
  description: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((s) => (s ? s : null)),
});

function readForm(formData: FormData) {
  return Schema.safeParse({
    name: formData.get('name'),
    peakCode: formData.get('peakCode'),
    description: formData.get('description'),
  });
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === 'P2002'
  );
}

function uniqueMessage(err: unknown): string {
  // P2002 with target=peakCode vs target=name produce different friendly text
  const meta = (err as { meta?: { target?: string[] } }).meta?.target;
  if (meta?.includes('peakCode')) return 'PEAK code นี้ถูกใช้แล้ว';
  return 'มีกลุ่มชื่อนี้อยู่แล้ว';
}

export async function createAccountingGroup(formData: FormData) {
  const { user } = await requirePermission('settings.accounting-group.manage');

  const parsed = readForm(formData);
  if (!parsed.success) {
    redirect(
      `/admin/settings/accounting-groups/new?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง')}`,
    );
  }

  try {
    const created = await prisma.accountingGroup.create({ data: parsed.data });
    auditLog({
      actorId: user.id,
      action: 'accountingGroup.create',
      entityType: 'AccountingGroup',
      entityId: created.id,
      after: parsed.data,
      metadata: { source: 'admin-ui' },
    });
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      redirect(
        `/admin/settings/accounting-groups/new?error=${encodeURIComponent(uniqueMessage(err))}`,
      );
    }
    throw err;
  }

  revalidatePath('/admin/settings/accounting-groups');
  redirect('/admin/settings/accounting-groups');
}

export async function updateAccountingGroup(id: string, formData: FormData) {
  const { user } = await requirePermission('settings.accounting-group.manage');

  const parsed = readForm(formData);
  if (!parsed.success) {
    redirect(
      `/admin/settings/accounting-groups/${id}/edit?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง')}`,
    );
  }

  const before = await prisma.accountingGroup.findUnique({ where: { id } });
  if (!before) redirect('/admin/settings/accounting-groups');

  try {
    await prisma.accountingGroup.update({ where: { id }, data: parsed.data });
    auditLog({
      actorId: user.id,
      action: 'accountingGroup.update',
      entityType: 'AccountingGroup',
      entityId: id,
      before: { name: before.name, peakCode: before.peakCode, description: before.description },
      after: parsed.data,
      metadata: { source: 'admin-ui' },
    });
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      redirect(
        `/admin/settings/accounting-groups/${id}/edit?error=${encodeURIComponent(uniqueMessage(err))}`,
      );
    }
    throw err;
  }

  revalidatePath('/admin/settings/accounting-groups');
  redirect('/admin/settings/accounting-groups');
}

export async function archiveAccountingGroup(id: string) {
  const { user } = await requirePermission('settings.accounting-group.manage');

  const before = await prisma.accountingGroup.findUnique({ where: { id } });
  if (!before || before.archivedAt) redirect('/admin/settings/accounting-groups');

  const dependents = await prisma.employee.count({
    where: { accountingGroupId: id, archivedAt: null },
  });
  if (dependents > 0) {
    redirect(
      `/admin/settings/accounting-groups?error=${encodeURIComponent(`มีพนักงาน ${dependents} คนอยู่ในกลุ่มนี้`)}`,
    );
  }

  await prisma.accountingGroup.update({
    where: { id },
    data: { archivedAt: new Date() },
  });
  auditLog({
    actorId: user.id,
    action: 'accountingGroup.archive',
    entityType: 'AccountingGroup',
    entityId: id,
    before: { name: before.name, peakCode: before.peakCode, description: before.description },
    metadata: { source: 'admin-ui' },
  });

  revalidatePath('/admin/settings/accounting-groups');
  redirect('/admin/settings/accounting-groups');
}
