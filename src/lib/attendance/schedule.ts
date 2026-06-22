/**
 * Per-employee "is today a working day for them?" — the missing link between
 * the company-wide working-week rule and each employee's WorkSchedule.
 *
 * Used by every "who's expected to check in today" surface (live board,
 * late-check cron, dashboard KPI) so an employee scheduled off today (e.g. a
 * Mon/Wed/Fri worker on a Saturday) isn't flagged as ยังไม่เช็คอิน.
 *
 * Pure + dependency-free.
 */

/**
 * @param scheduleDows The employee's WorkScheduleDay.dayOfWeek values
 *   (0=Sun … 6=Sat), or null/empty when no schedule is assigned.
 * @param dow Day-of-week of the date in question (0=Sun … 6=Sat) — use
 *   `getUTCDay()` on the UTC-midnight @db.Date so it reads the Bangkok weekday.
 * @param hasHoliday True if that date is a company Holiday.
 */
export function isScheduledWorkday(
  scheduleDows: ReadonlyArray<number> | null | undefined,
  dow: number,
  hasHoliday: boolean,
): boolean {
  if (hasHoliday) return false;
  if (scheduleDows && scheduleDows.length > 0) return scheduleDows.includes(dow);
  // No schedule assigned → fall back to the company default working week
  // (Mon–Sat; Sunday is the company's closed day — see working-days.ts).
  return dow !== 0;
}
