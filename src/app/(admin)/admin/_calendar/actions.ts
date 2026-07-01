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

import { getPermittedBranches, viaEmployeeBranchScope } from '@/lib/auth/branch-scope';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { getLeaveConfig } from '@/lib/leave/leave-config';
import { getOrgCalendarData } from '@/lib/leave/team-calendar';
import { currentMonthYM, parseMonth, type TeamCalendarData } from '@/lib/leave/team-calendar-shape';
import { expandHolidaysWithSubstitutes, workingDaysIn } from '@/lib/leave/working-days';
import { resolveStoredImageUrl } from '@/lib/storage/signed-urls';
import type { AdvanceRowVM } from '../advance/advance-review-modal';
import { ADVANCE_SELECT, advanceGuardVM, buildAdvanceRowVM } from '../advance/advance-row-vm';
import type { LeaveRowVM } from '../leave/leave-review-modal';
import { buildLeaveRowVM, LEAVE_SELECT, leaveOverQuotaVM } from '../leave/leave-row-vm';

export async function loadAdminCalendar(input: {
  ym: string;
  branchId: string | null;
}): Promise<TeamCalendarData> {
  const { user } = await requirePermission('dashboard.read');

  // Defensive parse: a malformed `ym` falls back to the current month rather
  // than throwing (mirrors the LIFF calendar page).
  const parsed = parseMonth(input.ym) ?? parseMonth(currentMonthYM());
  if (!parsed) throw new Error('Could not parse current month — date system broken?');

  const permitted = await getPermittedBranches(user, 'dashboard.read');
  return getOrgCalendarData({
    monthStart: parsed.start,
    monthEnd: parsed.end,
    branchId: input.branchId,
    permitted,
  });
}

/**
 * Fetch the full leave review VM for one request, for the calendar's
 * click-to-review. Same permission as the leave approve action.
 */
export async function getLeaveReviewRow(leaveRequestId: string): Promise<LeaveRowVM | null> {
  const { user } = await requirePermission('leave.approve');

  const permitted = await getPermittedBranches(user, 'leave.approve');
  const [row, holidays, cfg] = await Promise.all([
    prisma.leaveRequest.findFirst({
      where: { id: leaveRequestId, ...viaEmployeeBranchScope(permitted) },
      select: LEAVE_SELECT,
    }),
    prisma.holiday.findMany({ where: { archivedAt: null }, select: { date: true } }),
    getLeaveConfig(),
  ]);
  if (!row) return null;

  const expandedHolidays = expandHolidaysWithSubstitutes(holidays.map((h) => h.date));
  const workingDays = workingDaysIn({
    startDate: row.startDate,
    endDate: row.endDate,
    holidays: expandedHolidays,
  }).length;

  return buildLeaveRowVM(row, {
    attachmentUrl: await resolveStoredImageUrl(row.attachmentUrl),
    workingDays,
    cfg,
    overQuota: await leaveOverQuotaVM(row, workingDays, cfg),
  });
}

/**
 * Fetch the full cash-advance review VM for one request, for the calendar's
 * click-to-review. Same permission as the advance approve action.
 */
export async function getAdvanceReviewRow(cashAdvanceId: string): Promise<AdvanceRowVM | null> {
  const { user } = await requirePermission('advance.approve');

  const permitted = await getPermittedBranches(user, 'advance.approve');
  const row = await prisma.cashAdvance.findFirst({
    where: { id: cashAdvanceId, ...viaEmployeeBranchScope(permitted) },
    select: ADVANCE_SELECT,
  });
  if (!row) return null;

  const [receiptUrl, advanceGuard] = await Promise.all([
    resolveStoredImageUrl(row.receiptUrl),
    advanceGuardVM(row),
  ]);
  return buildAdvanceRowVM(row, { receiptUrl, advanceGuard });
}
