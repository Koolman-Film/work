'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { auditLog } from '@/lib/audit/log';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';

const TIME = z.string().regex(/^\d{2}:\d{2}$/, 'รูปแบบเวลาไม่ถูกต้อง (HH:MM)');
const Schema = z
  .object({
    morningStart: TIME,
    morningEnd: TIME,
    afternoonStart: TIME,
    afternoonEnd: TIME,
  })
  .refine((v) => v.morningStart < v.morningEnd, { message: 'เวลาเช้าไม่ถูกต้อง' })
  .refine((v) => v.afternoonStart < v.afternoonEnd, { message: 'เวลาบ่ายไม่ถูกต้อง' })
  .refine((v) => v.morningEnd <= v.afternoonStart, { message: 'ช่วงเช้า/บ่ายทับซ้อนกัน' });

export async function updateLeaveConfig(formData: FormData) {
  const { user } = await requirePermission('settings.leave-config.manage');
  const parsed = Schema.safeParse({
    morningStart: formData.get('morningStart'),
    morningEnd: formData.get('morningEnd'),
    afternoonStart: formData.get('afternoonStart'),
    afternoonEnd: formData.get('afternoonEnd'),
  });
  if (!parsed.success) {
    redirect(
      `/admin/settings/leave-config?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง')}`,
    );
  }

  const before = await prisma.leaveConfig.findFirst();
  if (before) {
    await prisma.leaveConfig.update({ where: { id: before.id }, data: parsed.data });
  } else {
    await prisma.leaveConfig.create({ data: parsed.data });
  }

  auditLog({
    actorId: user.id,
    action: 'leaveConfig.update',
    entityType: 'LeaveConfig',
    entityId: before?.id ?? 'new',
    ...(before
      ? {
          before: {
            morningStart: before.morningStart,
            morningEnd: before.morningEnd,
            afternoonStart: before.afternoonStart,
            afternoonEnd: before.afternoonEnd,
          },
        }
      : {}),
    after: parsed.data,
    metadata: { source: 'admin-ui' },
  });

  revalidatePath('/admin/settings/leave-config');
  redirect('/admin/settings/leave-config?ok=1');
}
