/**
 * Is `todayYmd` inside the cash-advance request blackout?
 *
 * The window is the `blackoutDays` days ENDING ON `cutoffDay` inclusive, so it
 * is expressed relative to the cutoff and stays aligned if the cutoff ever
 * moves. A fixed day-of-month range would silently de-align the day someone
 * edits PayrollConfig.cutoffDay. `blackoutDays` of 0 disables it.
 *
 * Deliberately does NOT wrap into the previous month. A window longer than the
 * cutoff day simply starts at day 1: those earlier days belong to a different
 * payroll period, and silently blocking a week nobody configured is worse than
 * a window that is a little short.
 *
 * Fails OPEN on bad input — a malformed date or nonsense window returns false
 * rather than locking every employee out of requesting. The cost of wrongly
 * allowing a request during the blackout is that an admin declines it; the cost
 * of wrongly blocking is that nobody can request at all and nothing says why.
 *
 * Pure: takes a YYYY-MM-DD string the caller has already resolved in
 * Asia/Bangkok. Blocks REQUESTING only — admins can still approve what is
 * already in flight, or in-flight requests would strand for days.
 */
export function isInAdvanceBlackout(
  todayYmd: string,
  cutoffDay: number,
  blackoutDays: number,
): boolean {
  if (!Number.isInteger(blackoutDays) || blackoutDays <= 0) return false;
  if (!Number.isInteger(cutoffDay) || cutoffDay < 1 || cutoffDay > 28) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(todayYmd)) return false;

  const day = Number(todayYmd.slice(8, 10));
  if (!Number.isInteger(day) || day < 1 || day > 31) return false;

  const from = Math.max(1, cutoffDay - blackoutDays + 1);
  return day >= from && day <= cutoffDay;
}
