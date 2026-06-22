'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { auditLog } from '@/lib/audit/log';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';

const Schema = z.object({
  workStartTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'รูปแบบเวลาไม่ถูกต้อง (HH:MM)'),
  // 0 = any minute past start counts as late; cap at 8h as a sanity bound.
  lateGraceMinutes: z.coerce.number().int().min(0).max(480),
});

export async function updateAttendanceConfig(formData: FormData) {
  const { user } = await requirePermission('settings.attendance.manage');

  const parsed = Schema.safeParse({
    workStartTime: formData.get('workStartTime'),
    lateGraceMinutes: formData.get('lateGraceMinutes'),
  });
  if (!parsed.success) {
    redirect(
      `/admin/settings/attendance?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง')}`,
    );
  }

  // PayrollConfig is a seeded singleton with many required fields, so we only
  // ever UPDATE it here (never create — that path belongs to the seed).
  const before = await prisma.payrollConfig.findFirst({
    select: { id: true, workStartTime: true, lateGraceMinutes: true },
  });
  if (!before) {
    redirect(
      `/admin/settings/attendance?error=${encodeURIComponent('ยังไม่มีการตั้งค่าระบบ (PayrollConfig) — รัน seed ก่อน')}`,
    );
  }

  await prisma.payrollConfig.update({ where: { id: before.id }, data: parsed.data });

  auditLog({
    actorId: user.id,
    action: 'payrollConfig.update',
    entityType: 'PayrollConfig',
    entityId: before.id,
    before: { workStartTime: before.workStartTime, lateGraceMinutes: before.lateGraceMinutes },
    after: parsed.data,
    metadata: { source: 'admin-ui', section: 'attendance-late-policy' },
  });

  revalidatePath('/admin/settings/attendance');
  redirect('/admin/settings/attendance?ok=1');
}
