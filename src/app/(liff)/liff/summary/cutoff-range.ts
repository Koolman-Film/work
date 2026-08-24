/**
 * Whether a month-mode report window covers the whole calendar month.
 *
 * /liff/summary resolves month mode against the PAYROLL CUTOFF, so "สิงหาคม"
 * usually means 27 ก.ค. – 26 ส.ค., not 1–31 ส.ค. The page prints the real
 * range under the month label so the worker can see which days their counts
 * cover — but only when it differs, otherwise the line just restates the
 * heading. With no PayrollConfig row the window IS the calendar month, and
 * this returns true so nothing extra is drawn.
 *
 * Pure — plain YYYY-MM / YYYY-MM-DD strings, no Date parsing pitfalls beyond
 * the last-day lookup (Date.UTC(y, m, 0) = last day of month m).
 */
export function isWholeCalendarMonth(month: string, from: string, to: string): boolean {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return false;
  // Day 0 of the NEXT month is the last day of this one — handles 28/29/30/31
  // without a leap-year table.
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return from === `${month}-01` && to === `${month}-${pad(lastDay)}`;
}
