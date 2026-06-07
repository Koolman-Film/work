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
import { getOrgCalendarData } from '@/lib/leave/team-calendar';
import { currentMonthYM, parseMonth, type TeamCalendarData } from '@/lib/leave/team-calendar-shape';

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
