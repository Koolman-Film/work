'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { auditLog } from '@/lib/audit/log';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { parseInputDate } from '@/lib/leave/working-days';

/**
 * Holiday CRUD actions. Same shape as the other settings CRUDs.
 *
 * Authorization (Phase 3.2 — first migrated route):
 *   - Gated by `requirePermission('settings.holiday.manage')`. No
 *     branchId is passed because Holiday is a GLOBAL config entity
 *     (not branch-scoped) — every Holiday applies to every branch.
 *   - The page-level admin layout still enforces "you're an admin
 *     SOMEWHERE" via requireRole. This action enforces the finer
 *     "you can manage holidays" permission. Both layers are intentional
 *     — defense in depth.
 *
 * Validation notes:
 *   - `date` parsed with the same strict YYYY-MM-DD validator used by the
 *     leave-request form (rejects 2026-02-30 and similar calendar
 *     impossibilities).
 *   - `isSubstitute` is the "Thai cabinet decree" / auto-shifted Monday
 *     boundary case from the schema comment. UI surfaces it as a chip;
 *     the leave-approval working-day calc doesn't distinguish.
 *   - No FK dependents — Holiday is read by workingDaysIn() but never
 *     referenced via foreign-key from another table. Archive is always
 *     safe (no dependents check needed).
 */

const Schema = z.object({
  date: z.string().trim().min(1, 'กรุณาเลือกวันที่'),
  name: z.string().trim().min(1, 'กรุณากรอกชื่อวันหยุด').max(100),
  isSubstitute: z
    .literal('on')
    .optional()
    .transform((v) => v === 'on'),
});

function readForm(formData: FormData) {
  return Schema.safeParse({
    date: formData.get('date'),
    name: formData.get('name'),
    isSubstitute: formData.get('isSubstitute') ?? undefined,
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

type ParsedData = { date: Date; name: string; isSubstitute: boolean };

function normalize(parsed: z.infer<typeof Schema>): ParsedData | { error: string } {
  const date = parseInputDate(parsed.date);
  if (!date) return { error: 'รูปแบบวันที่ไม่ถูกต้อง' };
  return { date, name: parsed.name, isSubstitute: parsed.isSubstitute ?? false };
}

export async function createHoliday(formData: FormData) {
  const { user } = await requirePermission('settings.holiday.manage');

  const parsed = readForm(formData);
  if (!parsed.success) {
    redirect(
      `/admin/settings/holidays/new?error=${encodeURIComponent(
        parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง',
      )}`,
    );
  }
  const data = normalize(parsed.data);
  if ('error' in data) {
    redirect(`/admin/settings/holidays/new?error=${encodeURIComponent(data.error)}`);
  }

  try {
    const created = await prisma.holiday.create({ data });
    auditLog({
      actorId: user.id,
      action: 'holiday.create',
      entityType: 'Holiday',
      entityId: created.id,
      after: {
        date: data.date.toISOString().slice(0, 10),
        name: data.name,
        isSubstitute: data.isSubstitute,
      },
      metadata: { source: 'admin-ui' },
    });
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      redirect(`/admin/settings/holidays/new?error=${encodeURIComponent('มีวันหยุดในวันที่นี้อยู่แล้ว')}`);
    }
    throw err;
  }

  revalidatePath('/admin/settings/holidays');
  redirect('/admin/settings/holidays');
}

export async function updateHoliday(id: string, formData: FormData) {
  const { user } = await requirePermission('settings.holiday.manage');

  const parsed = readForm(formData);
  if (!parsed.success) {
    redirect(
      `/admin/settings/holidays/${id}/edit?error=${encodeURIComponent(
        parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง',
      )}`,
    );
  }
  const data = normalize(parsed.data);
  if ('error' in data) {
    redirect(`/admin/settings/holidays/${id}/edit?error=${encodeURIComponent(data.error)}`);
  }

  const before = await prisma.holiday.findUnique({ where: { id } });
  if (!before) redirect('/admin/settings/holidays');

  try {
    await prisma.holiday.update({ where: { id }, data });
    auditLog({
      actorId: user.id,
      action: 'holiday.update',
      entityType: 'Holiday',
      entityId: id,
      before: {
        date: before.date.toISOString().slice(0, 10),
        name: before.name,
        isSubstitute: before.isSubstitute,
      },
      after: {
        date: data.date.toISOString().slice(0, 10),
        name: data.name,
        isSubstitute: data.isSubstitute,
      },
      metadata: { source: 'admin-ui' },
    });
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      redirect(
        `/admin/settings/holidays/${id}/edit?error=${encodeURIComponent('มีวันหยุดในวันที่นี้อยู่แล้ว')}`,
      );
    }
    throw err;
  }

  revalidatePath('/admin/settings/holidays');
  redirect('/admin/settings/holidays');
}

export async function archiveHoliday(id: string) {
  const { user } = await requirePermission('settings.holiday.manage');

  const before = await prisma.holiday.findUnique({ where: { id } });
  if (!before || before.archivedAt) redirect('/admin/settings/holidays');

  // No FK dependents — Holiday is read by workingDaysIn() at approval time,
  // never referenced via foreign key. Safe to archive at any time. Past
  // leave-approvals already stored their Attendance(OnLeave) rows; this
  // archive only affects FUTURE approvals.
  await prisma.holiday.update({
    where: { id },
    data: { archivedAt: new Date() },
  });
  auditLog({
    actorId: user.id,
    action: 'holiday.archive',
    entityType: 'Holiday',
    entityId: id,
    before: {
      date: before.date.toISOString().slice(0, 10),
      name: before.name,
      isSubstitute: before.isSubstitute,
    },
    metadata: { source: 'admin-ui' },
  });

  revalidatePath('/admin/settings/holidays');
  redirect('/admin/settings/holidays');
}
