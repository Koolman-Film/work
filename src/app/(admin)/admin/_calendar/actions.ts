'use server';

/**
 * Server action backing the dashboard calendar island. Fetches a month of
 * org-wide (or single-branch) leave + holidays.
 *
 * Gated by `requirePermission('dashboard.read')` — the SAME permission as the
 * dashboard page. Server actions are independently callable POST endpoints, so
 * we re-check here (defense in depth) rather than trusting that the page
 * rendered.
 */

import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { getOrgCalendarData } from '@/lib/leave/team-calendar';
import { currentMonthYM, parseMonth, type TeamCalendarData } from '@/lib/leave/team-calendar-shape';
import { expandHolidaysWithSubstitutes, workingDaysIn } from '@/lib/leave/working-days';
import { signAttendancePhotoUrls } from '@/lib/storage/signed-urls';
import type { AdvanceRowVM } from '../advance/advance-review-modal';
import { ADVANCE_SELECT, buildAdvanceRowVM } from '../advance/advance-row-vm';
import type { LeaveRowVM } from '../leave/leave-review-modal';
import { buildLeaveRowVM, LEAVE_SELECT } from '../leave/leave-row-vm';

export async function loadAdminCalendar(input: {
  ym: string;
  branchId: string | null;
}): Promise<TeamCalendarData> {
  await requirePermission('dashboard.read');

  // Defensive parse: a malformed `ym` falls back to the current month rather
  // than throwing (mirrors the LIFF calendar page).
  const parsed = parseMonth(input.ym) ?? parseMonth(currentMonthYM());
  if (!parsed) throw new Error('Could not parse current month — date system broken?');

  return getOrgCalendarData({
    monthStart: parsed.start,
    monthEnd: parsed.end,
    branchId: input.branchId,
  });
}

/** Resolve a possibly-relative storage key to a signed URL (or pass through http URLs). */
async function resolveOne(value: string | null): Promise<string | null> {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  const signed = await signAttendancePhotoUrls([value]);
  return signed.get(value) ?? null;
}

/**
 * Fetch the full leave review VM for one request, for the calendar's
 * click-to-review. Same permission as the leave approve action.
 */
export async function getLeaveReviewRow(leaveRequestId: string): Promise<LeaveRowVM | null> {
  await requirePermission('leave.approve');

  const [row, holidays] = await Promise.all([
    prisma.leaveRequest.findUnique({ where: { id: leaveRequestId }, select: LEAVE_SELECT }),
    prisma.holiday.findMany({ where: { archivedAt: null }, select: { date: true } }),
  ]);
  if (!row) return null;

  const expandedHolidays = expandHolidaysWithSubstitutes(holidays.map((h) => h.date));
  const workingDays = workingDaysIn({
    startDate: row.startDate,
    endDate: row.endDate,
    holidays: expandedHolidays,
  }).length;

  return buildLeaveRowVM(row, {
    attachmentUrl: await resolveOne(row.attachmentUrl),
    workingDays,
  });
}

/**
 * Fetch the full cash-advance review VM for one request, for the calendar's
 * click-to-review. Same permission as the advance approve action.
 */
export async function getAdvanceReviewRow(cashAdvanceId: string): Promise<AdvanceRowVM | null> {
  await requirePermission('advance.approve');

  const row = await prisma.cashAdvance.findUnique({
    where: { id: cashAdvanceId },
    select: ADVANCE_SELECT,
  });
  if (!row) return null;

  return buildAdvanceRowVM(row, { receiptUrl: await resolveOne(row.receiptUrl) });
}
