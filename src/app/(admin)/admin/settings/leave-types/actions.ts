'use server';

import { OverQuotaPolicy, Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { auditLog } from '@/lib/audit/log';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';

const WORKER_NAME_LOCALES = ['en', 'my', 'lo', 'zh-CN', 'km'] as const;

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
  allowFullDay: z
    .literal('on')
    .optional()
    .transform((v) => v === 'on'),
  allowHalfDay: z
    .literal('on')
    .optional()
    .transform((v) => v === 'on'),
  allowHourly: z
    .literal('on')
    .optional()
    .transform((v) => v === 'on'),
  overQuotaPolicy: z.nativeEnum(OverQuotaPolicy).optional().default(OverQuotaPolicy.DeductPay),
});

/** Collect optional per-locale name inputs (name_en, name_my, …) into the
 *  nameByLocale JSON map; blank inputs are dropped. Empty map → null so the
 *  column reads as "no translations" rather than {}. */
function readNameByLocale(formData: FormData): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const code of WORKER_NAME_LOCALES) {
    const raw = formData.get(`name_${code}`);
    if (typeof raw !== 'string') continue;
    const v = raw.trim().slice(0, 80);
    if (v !== '') out[code] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function readForm(formData: FormData) {
  return Schema.safeParse({
    name: formData.get('name'),
    isPaid: formData.get('isPaid') ?? undefined,
    annualQuota: formData.get('annualQuota'),
    overQuotaPolicy: formData.get('overQuotaPolicy') ?? undefined,
    allowFullDay: formData.get('allowFullDay') ?? undefined,
    allowHalfDay: formData.get('allowHalfDay') ?? undefined,
    allowHourly: formData.get('allowHourly') ?? undefined,
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
  nameByLocale: Record<string, string> | null;
  isPaid: boolean;
  annualQuota: number | null;
  overQuotaPolicy: 'Block' | 'DeductPay';
  allowFullDay: boolean;
  allowHalfDay: boolean;
  allowHourly: boolean;
};

function normalize(
  parsed: z.infer<typeof Schema>,
  nameByLocale: Record<string, string> | null,
): ParsedData {
  return {
    name: parsed.name,
    nameByLocale,
    isPaid: parsed.isPaid ?? false,
    annualQuota: parsed.annualQuota ?? null,
    overQuotaPolicy: parsed.overQuotaPolicy,
    allowFullDay: parsed.allowFullDay ?? false,
    allowHalfDay: parsed.allowHalfDay ?? false,
    allowHourly: parsed.allowHourly ?? false,
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

  const data = normalize(parsed.data, readNameByLocale(formData));

  if (!data.allowFullDay && !data.allowHalfDay && !data.allowHourly) {
    redirect(
      `/admin/settings/leave-types/new?error=${encodeURIComponent('ต้องเลือกอย่างน้อยหนึ่งหน่วยการลา')}`,
    );
  }

  try {
    const created = await prisma.leaveType.create({
      data: { ...data, nameByLocale: data.nameByLocale ?? Prisma.DbNull },
    });
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

  const data = normalize(parsed.data, readNameByLocale(formData));

  if (!data.allowFullDay && !data.allowHalfDay && !data.allowHourly) {
    redirect(
      `/admin/settings/leave-types/${id}/edit?error=${encodeURIComponent('ต้องเลือกอย่างน้อยหนึ่งหน่วยการลา')}`,
    );
  }

  try {
    await prisma.leaveType.update({
      where: { id },
      data: { ...data, nameByLocale: data.nameByLocale ?? Prisma.DbNull },
    });
    auditLog({
      actorId: user.id,
      action: 'leaveType.update',
      entityType: 'LeaveType',
      entityId: id,
      before: {
        name: before.name,
        nameByLocale: before.nameByLocale,
        isPaid: before.isPaid,
        annualQuota: before.annualQuota,
        overQuotaPolicy: before.overQuotaPolicy,
        allowFullDay: before.allowFullDay,
        allowHalfDay: before.allowHalfDay,
        allowHourly: before.allowHourly,
      },
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
