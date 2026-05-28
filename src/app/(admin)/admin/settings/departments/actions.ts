'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { auditLog } from '@/lib/audit/log';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';

const Schema = z.object({
  name: z.string().trim().min(1, 'กรุณากรอกชื่อแผนก').max(80),
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

export async function createDepartment(formData: FormData) {
  const { user } = await requirePermission('settings.department.manage');

  const parsed = readForm(formData);
  if (!parsed.success) {
    redirect(
      `/admin/settings/departments/new?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง')}`,
    );
  }

  try {
    const created = await prisma.department.create({ data: parsed.data });
    auditLog({
      actorId: user.id,
      action: 'department.create',
      entityType: 'Department',
      entityId: created.id,
      after: parsed.data,
      metadata: { source: 'admin-ui' },
    });
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      redirect(`/admin/settings/departments/new?error=${encodeURIComponent('มีแผนกชื่อนี้อยู่แล้ว')}`);
    }
    throw err;
  }

  revalidatePath('/admin/settings/departments');
  redirect('/admin/settings/departments');
}

export async function updateDepartment(id: string, formData: FormData) {
  const { user } = await requirePermission('settings.department.manage');

  const parsed = readForm(formData);
  if (!parsed.success) {
    redirect(
      `/admin/settings/departments/${id}/edit?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง')}`,
    );
  }

  const before = await prisma.department.findUnique({ where: { id } });
  if (!before) redirect('/admin/settings/departments');

  try {
    await prisma.department.update({ where: { id }, data: parsed.data });
    auditLog({
      actorId: user.id,
      action: 'department.update',
      entityType: 'Department',
      entityId: id,
      before: { name: before.name, description: before.description },
      after: parsed.data,
      metadata: { source: 'admin-ui' },
    });
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      redirect(
        `/admin/settings/departments/${id}/edit?error=${encodeURIComponent('มีแผนกชื่อนี้อยู่แล้ว')}`,
      );
    }
    throw err;
  }

  revalidatePath('/admin/settings/departments');
  redirect('/admin/settings/departments');
}

export async function archiveDepartment(id: string) {
  const { user } = await requirePermission('settings.department.manage');

  const before = await prisma.department.findUnique({ where: { id } });
  if (!before || before.archivedAt) redirect('/admin/settings/departments');

  const dependents = await prisma.employee.count({
    where: { departmentId: id, archivedAt: null },
  });
  if (dependents > 0) {
    redirect(
      `/admin/settings/departments?error=${encodeURIComponent(`มีพนักงาน ${dependents} คนอยู่ในแผนกนี้`)}`,
    );
  }

  await prisma.department.update({
    where: { id },
    data: { archivedAt: new Date() },
  });
  auditLog({
    actorId: user.id,
    action: 'department.archive',
    entityType: 'Department',
    entityId: id,
    before: { name: before.name, description: before.description },
    metadata: { source: 'admin-ui' },
  });

  revalidatePath('/admin/settings/departments');
  redirect('/admin/settings/departments');
}
