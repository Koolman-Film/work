'use server';

/**
 * WorkSchedule CRUD Server Actions.
 *
 * Form payload shape (per-day rows arrive as repeated keys):
 *
 *   name                     "ตารางมาตรฐาน"
 *   lateToleranceMin         "15"
 *   day-0-enabled            (absent if Sunday closed)
 *   day-0-startTime          "09:00"
 *   day-0-endTime            "18:00"
 *   day-1-enabled            "on"
 *   day-1-startTime          "09:00"
 *   day-1-endTime            "18:00"
 *   ... (one set per dayOfWeek 0-6)
 *
 * Validation strategy:
 *   - Parse each day's three fields independently
 *   - A day is "enabled" only when day-N-enabled='on' AND both times
 *     are well-formed HH:MM
 *   - End must be strictly after start (a 0-duration day is a config error)
 *   - At least ONE day must be enabled (a schedule with no working days
 *     can't actually schedule anything)
 *
 * Update strategy:
 *   - Delete-all-then-re-create the WorkScheduleDay rows inside a single
 *     transaction. The set is at most 7 rows; the "diff and patch"
 *     approach would be more efficient but the bookkeeping isn't worth
 *     it at this scale. Cascade delete handles the children when we
 *     replace the parent.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { auditLog } from '@/lib/audit/log';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';

// ─── Validation ────────────────────────────────────────────────────────────

/**
 * HH:MM 24-hour. Accepts both leading-zero ("09:00") and not ("9:00").
 * Stored normalized to leading-zero for consistency.
 */
const TimeSchema = z
  .string()
  .trim()
  .regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'รูปแบบเวลาต้องเป็น HH:MM')
  .transform((s) => {
    const [h, m] = s.split(':');
    if (!h || !m) throw new Error('unreachable');
    return `${h.padStart(2, '0')}:${m}`;
  });

const DaySchema = z
  .object({
    enabled: z.boolean(),
    startTime: z.string().optional(),
    endTime: z.string().optional(),
  })
  .refine(
    (d) => {
      if (!d.enabled) return true;
      // When enabled, both times must be present and well-formed.
      const start = TimeSchema.safeParse(d.startTime);
      const end = TimeSchema.safeParse(d.endTime);
      if (!start.success || !end.success) return false;
      // End must be strictly after start.
      return start.data < end.data;
    },
    {
      message: 'เวลาเริ่ม-เลิกงานไม่ถูกต้อง (เวลาเลิกต้องอยู่หลังเวลาเริ่ม)',
    },
  );

const ScheduleSchema = z
  .object({
    name: z.string().trim().min(1, 'กรุณากรอกชื่อตาราง').max(80),
    lateToleranceMin: z
      .string()
      .optional()
      .transform((s) => {
        if (!s) return 15;
        const n = Number(s);
        return Number.isFinite(n) && n >= 0 && n <= 240 ? Math.round(n) : 15;
      }),
    // Indexed 0..6 (Sun..Sat)
    days: z.array(DaySchema).length(7),
  })
  .refine((d) => d.days.some((day) => day.enabled), {
    message: 'กรุณาเลือกอย่างน้อย 1 วันทำงาน',
    path: ['days'],
  });

function readForm(formData: FormData) {
  const days = Array.from({ length: 7 }, (_, dow) => ({
    enabled: formData.get(`day-${dow}-enabled`) === 'on',
    startTime: (formData.get(`day-${dow}-startTime`) as string | null) ?? undefined,
    endTime: (formData.get(`day-${dow}-endTime`) as string | null) ?? undefined,
  }));
  return ScheduleSchema.safeParse({
    name: formData.get('name'),
    lateToleranceMin: formData.get('lateToleranceMin'),
    days,
  });
}

/** Build the WorkScheduleDay createMany payload from validated form data. */
function daysCreatePayload(
  validated: ReadonlyArray<{ enabled: boolean; startTime?: string; endTime?: string }>,
) {
  return validated
    .map((d, dow) =>
      d.enabled
        ? {
            dayOfWeek: dow,
            // We've already validated these via TimeSchema in the refine —
            // safe to assert non-null + reformat with the canonical HH:MM.
            startTime: TimeSchema.parse(d.startTime),
            endTime: TimeSchema.parse(d.endTime),
          }
        : null,
    )
    .filter((x): x is { dayOfWeek: number; startTime: string; endTime: string } => x != null);
}

// ─── Create ────────────────────────────────────────────────────────────────

export async function createWorkSchedule(formData: FormData) {
  const { user } = await requirePermission('settings.work-schedule.manage');

  const parsed = readForm(formData);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง';
    redirect(`/admin/settings/work-schedules/new?error=${encodeURIComponent(msg)}`);
  }

  const days = daysCreatePayload(parsed.data.days);

  const created = await prisma.workSchedule.create({
    data: {
      name: parsed.data.name,
      lateToleranceMin: parsed.data.lateToleranceMin,
      days: { create: days },
    },
    include: { days: true },
  });
  auditLog({
    actorId: user.id,
    action: 'workSchedule.create',
    entityType: 'WorkSchedule',
    entityId: created.id,
    after: {
      name: created.name,
      lateToleranceMin: created.lateToleranceMin,
      days: days.map((d) => `${d.dayOfWeek}:${d.startTime}-${d.endTime}`),
    },
    metadata: { source: 'admin-ui' },
  });

  revalidatePath('/admin/settings/work-schedules');
  redirect('/admin/settings/work-schedules');
}

// ─── Update ────────────────────────────────────────────────────────────────

export async function updateWorkSchedule(id: string, formData: FormData) {
  const { user } = await requirePermission('settings.work-schedule.manage');

  const parsed = readForm(formData);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง';
    redirect(`/admin/settings/work-schedules/${id}/edit?error=${encodeURIComponent(msg)}`);
  }

  const before = await prisma.workSchedule.findUnique({
    where: { id },
    include: { days: true },
  });
  if (!before) {
    redirect(`/admin/settings/work-schedules?error=${encodeURIComponent('ไม่พบตารางงาน')}`);
  }

  const days = daysCreatePayload(parsed.data.days);

  // Atomic update: replace the day rows wholesale rather than diff/patch.
  // 7 rows max — the simplicity is worth more than the marginal write cost.
  await prisma.$transaction(async (tx) => {
    await tx.workScheduleDay.deleteMany({ where: { workScheduleId: id } });
    await tx.workSchedule.update({
      where: { id },
      data: {
        name: parsed.data.name,
        lateToleranceMin: parsed.data.lateToleranceMin,
        days: { create: days },
      },
    });
  });

  auditLog({
    actorId: user.id,
    action: 'workSchedule.update',
    entityType: 'WorkSchedule',
    entityId: id,
    before: {
      name: before.name,
      lateToleranceMin: before.lateToleranceMin,
      days: before.days
        .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
        .map((d) => `${d.dayOfWeek}:${d.startTime}-${d.endTime}`),
    },
    after: {
      name: parsed.data.name,
      lateToleranceMin: parsed.data.lateToleranceMin,
      days: days.map((d) => `${d.dayOfWeek}:${d.startTime}-${d.endTime}`),
    },
    metadata: { source: 'admin-ui' },
  });

  revalidatePath('/admin/settings/work-schedules');
  redirect('/admin/settings/work-schedules');
}

// ─── Archive ───────────────────────────────────────────────────────────────

export async function archiveWorkSchedule(id: string) {
  const { user } = await requirePermission('settings.work-schedule.manage');

  const before = await prisma.workSchedule.findUnique({ where: { id } });
  if (!before) {
    redirect(`/admin/settings/work-schedules?error=${encodeURIComponent('ไม่พบตารางงาน')}`);
  }
  if (before.archivedAt) {
    redirect('/admin/settings/work-schedules'); // already archived
  }

  // Refuse if any Employee references this schedule. Admin must reassign first.
  const usage = await prisma.employee.count({
    where: { workScheduleId: id, archivedAt: null },
  });
  if (usage > 0) {
    redirect(
      `/admin/settings/work-schedules?error=${encodeURIComponent(
        `มีพนักงาน ${usage} คนใช้ตารางนี้อยู่ — เปลี่ยนตารางของพนักงานก่อน`,
      )}`,
    );
  }

  await prisma.workSchedule.update({
    where: { id },
    data: { archivedAt: new Date() },
  });
  auditLog({
    actorId: user.id,
    action: 'workSchedule.archive',
    entityType: 'WorkSchedule',
    entityId: id,
    before: { name: before.name },
    metadata: { source: 'admin-ui' },
  });

  revalidatePath('/admin/settings/work-schedules');
  redirect('/admin/settings/work-schedules');
}
