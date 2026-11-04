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
 *     branchId is passed: Holiday is a GLOBAL config entity. A row can
 *     still apply to listed branches only (`branchIds`, matched on the
 *     employee's home branch — see lib/leave/holiday-scope.ts); empty =
 *     every branch.
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
  scope: z.enum(['all', 'branches']),
  branchIds: z.array(z.string().uuid()),
});

function readForm(formData: FormData) {
  return Schema.safeParse({
    date: formData.get('date'),
    name: formData.get('name'),
    isSubstitute: formData.get('isSubstitute') ?? undefined,
    scope: formData.get('scope') ?? 'all',
    branchIds: formData.getAll('branchIds').map(String),
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

type ParsedData = { date: Date; name: string; isSubstitute: boolean; branchIds: string[] };

async function normalize(parsed: z.infer<typeof Schema>): Promise<ParsedData | { error: string }> {
  const date = parseInputDate(parsed.date);
  if (!date) return { error: 'รูปแบบวันที่ไม่ถูกต้อง' };
  let branchIds: string[] = [];
  if (parsed.scope === 'branches') {
    branchIds = [...new Set(parsed.branchIds)].sort();
    if (branchIds.length === 0) return { error: 'กรุณาเลือกอย่างน้อยหนึ่งสาขา' };
    const found = await prisma.branch.count({ where: { id: { in: branchIds }, archivedAt: null } });
    if (found !== branchIds.length) return { error: 'ไม่พบสาขาที่เลือก' };
  }
  return { date, name: parsed.name, isSubstitute: parsed.isSubstitute ?? false, branchIds };
}

/** Audit shape — one place so create/update/archive record the same fields. */
function auditShape(h: { date: Date; name: string; isSubstitute: boolean; branchIds: string[] }) {
  return {
    date: h.date.toISOString().slice(0, 10),
    name: h.name,
    isSubstitute: h.isSubstitute,
    branchIds: h.branchIds,
  };
}

const DATE_TAKEN = 'มีวันหยุดในวันที่นี้อยู่แล้ว — ถ้าต้องการให้สาขาอื่นหยุดวันเดียวกัน ให้แก้ไขวันหยุดเดิมแล้วเลือกเพิ่มสาขา';

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
  const data = await normalize(parsed.data);
  if ('error' in data) {
    redirect(`/admin/settings/holidays/new?error=${encodeURIComponent(data.error)}`);
  }

  try {
    // `date` is unique across archived rows too, so a holiday that was archived
    // still owns its date and a plain create would fail with nothing the admin
    // can open (archived rows are hidden). Revive that row with the new data.
    const sameDate = await prisma.holiday.findUnique({
      where: { date: data.date },
      select: { id: true, archivedAt: true },
    });
    const archived = sameDate?.archivedAt ? sameDate : null;
    const created = archived
      ? await prisma.holiday.update({
          where: { id: archived.id },
          data: { ...data, archivedAt: null },
        })
      : await prisma.holiday.create({ data });
    auditLog({
      actorId: user.id,
      action: 'holiday.create',
      entityType: 'Holiday',
      entityId: created.id,
      after: auditShape(data),
      metadata: { source: 'admin-ui', ...(archived ? { revivedArchivedRow: true } : {}) },
    });
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      redirect(`/admin/settings/holidays/new?error=${encodeURIComponent(DATE_TAKEN)}`);
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
  const data = await normalize(parsed.data);
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
      before: auditShape(before),
      after: auditShape(data),
      metadata: { source: 'admin-ui' },
    });
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      redirect(`/admin/settings/holidays/${id}/edit?error=${encodeURIComponent(DATE_TAKEN)}`);
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
    before: auditShape(before),
    metadata: { source: 'admin-ui' },
  });

  revalidatePath('/admin/settings/holidays');
  redirect('/admin/settings/holidays');
}
