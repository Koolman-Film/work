/**
 * Payroll period windowing.
 *
 * A payroll "month" (YYYY-MM) covers the cutoff window ENDING on that month's
 * cutoff day: (prevMonth, cutoffDay+1) .. (thisMonth, cutoffDay), inclusive.
 * With cutoffDay = 26 that is the 27th of the previous month → 26th of this
 * month — the company's รอบจ่ายเงินเดือน (PDF C8). Pure UTC day-arithmetic.
 *
 * Returns UTC-midnight Date bounds matching @db.Date semantics. `end` is the
 * INCLUSIVE cutoff day, so range queries use `{ gte: start, lte: end }`.
 *
 * cutoffDay is bounded 1–28 (same as payrollPeriodFor) so `cutoffDay + 1`
 * never overflows a short month (Feb 28) into the next via Date.UTC rollover.
 */
export function payrollMonthWindow(month: string, cutoffDay: number): { start: Date; end: Date } {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) throw new Error(`payrollMonthWindow: invalid month '${month}'`);
  if (!Number.isInteger(cutoffDay) || cutoffDay < 1 || cutoffDay > 28)
    throw new Error(`payrollMonthWindow: cutoffDay must be 1–28, got ${cutoffDay}`);
  const end = new Date(Date.UTC(y, m - 1, cutoffDay));
  const start = new Date(Date.UTC(y, m - 2, cutoffDay + 1));
  return { start, end };
}

/** YMD-string form (inclusive) for the report period resolver + UI labels. */
export function payrollMonthWindowYmd(
  month: string,
  cutoffDay: number,
): { from: string; to: string } {
  const { start, end } = payrollMonthWindow(month, cutoffDay);
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}
