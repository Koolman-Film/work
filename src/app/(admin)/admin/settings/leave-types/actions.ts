'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { auditLog } from '@/lib/audit/log';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';

const Schema = z.object({
  name: z.string().trim().min(1, 'กรุณากรอกชื่อประเภทการลา').max(80),
  // Checkbox semantics: the form posts the value only when checked. We
  // treat presence-of-key as true, absence as false.
  isPaid: z
    .literal('on')
    .optional()
    .transform((v) => v === 'on'),
  annualQuota: z
    .union([
      z
        .string()
        .trim()
        .length(0)
        .transform(() => null),
      z.coerce.number().int().min(0).max(365),
    ])
    .nullable()
    .optional(),
});

function readForm(formData: FormData) {
  return Schema.safeParse({
    name: formData.get('name'),
    isPaid: formData.get('isPaid') ?? undefined,
    annualQuota: formData.get('annualQuota'),
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

type ParsedData = {
  name: string;
  isPaid: boolean;
  annualQuota: number | null;
};

function normalize(parsed: z.infer<typeof Schema>): ParsedData {
  return {
    name: parsed.name,
    isPaid: parsed.isPaid ?? false,
    annualQuota: parsed.annualQuota ?? null,
  };
}

export async function createLeaveType(formData: FormData) {
  const { user } = await requirePermission('settings.leave-type.manage');

  const parsed = readForm(formData);
  if (!parsed.success) {
    redirect(
      `/admin/settings/leave-types/new?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง')}`,
    );
  }

  const data = normalize(parsed.data);

  try {
    const created = await prisma.leaveType.create({ data });
    auditLog({
      actorId: user.id,
      action: 'leaveType.create',
      entityType: 'LeaveType',
      entityId: created.id,
      after: data,
      metadata: { source: 'admin-ui' },
    });
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      redirect(
        `/admin/settings/leave-types/new?error=${encodeURIComponent('มีประเภทการลาชื่อนี้อยู่แล้ว')}`,
      );
    }
    throw err;
  }

  revalidatePath('/admin/settings/leave-types');
  redirect('/admin/settings/leave-types');
}

export async function updateLeaveType(id: string, formData: FormData) {
  const { user } = await requirePermission('settings.leave-type.manage');

  const parsed = readForm(formData);
  if (!parsed.success) {
    redirect(
      `/admin/settings/leave-types/${id}/edit?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง')}`,
    );
  }

  const before = await prisma.leaveType.findUnique({ where: { id } });
  if (!before) redirect('/admin/settings/leave-types');

  const data = normalize(parsed.data);

  try {
    await prisma.leaveType.update({ where: { id }, data });
    auditLog({
      actorId: user.id,
      action: 'leaveType.update',
      entityType: 'LeaveType',
      entityId: id,
      before: { name: before.name, isPaid: before.isPaid, annualQuota: before.annualQuota },
      after: data,
      metadata: { source: 'admin-ui' },
    });
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      redirect(
        `/admin/settings/leave-types/${id}/edit?error=${encodeURIComponent('มีประเภทการลาชื่อนี้อยู่แล้ว')}`,
      );
    }
    throw err;
  }

  revalidatePath('/admin/settings/leave-types');
  redirect('/admin/settings/leave-types');
}

export async function archiveLeaveType(id: string) {
  const { user } = await requirePermission('settings.leave-type.manage');

  const before = await prisma.leaveType.findUnique({ where: { id } });
  if (!before || before.archivedAt) redirect('/admin/settings/leave-types');

  // Block archive if there are still pending/approved requests referencing
  // this type — payroll/reporting still needs the joined row to make sense.
  // Archive vs hard-delete: archive flips archivedAt; existing rows continue
  // to display but the type is hidden from the LIFF picker.
  const activeReferences = await prisma.leaveRequest.count({
    where: {
      leaveTypeId: id,
      status: { in: ['Pending', 'Approved'] },
    },
  });
  if (activeReferences > 0) {
    redirect(
      `/admin/settings/leave-types?error=${encodeURIComponent(
        `มีคำขอลา ${activeReferences} รายการที่ใช้ประเภทนี้อยู่ — รออนุมัติ/ปฏิเสธก่อน`,
      )}`,
    );
  }

  await prisma.leaveType.update({
    where: { id },
    data: { archivedAt: new Date() },
  });
  auditLog({
    actorId: user.id,
    action: 'leaveType.archive',
    entityType: 'LeaveType',
    entityId: id,
    before: { name: before.name, isPaid: before.isPaid, annualQuota: before.annualQuota },
    metadata: { source: 'admin-ui' },
  });

  revalidatePath('/admin/settings/leave-types');
  redirect('/admin/settings/leave-types');
}
