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
import { formatThaiDate } from '@/lib/format';

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

/**
 * Human-readable Thai date range for the cutoff window — e.g.
 * "27 พ.ค. 2569 – 26 มิ.ย. 2569". Surfaced on the payroll page so its period
 * is visibly the SAME window resolveReportPeriod builds for the reports pages
 * (both consume PayrollConfig.cutoffDay). Uses the shared formatThaiDate so the
 * era/spacing match the rest of the admin UI.
 */
export function payrollPeriodLabel(month: string, cutoffDay: number): string {
  const { from, to } = payrollMonthWindowYmd(month, cutoffDay);
  const asDate = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
  return `${formatThaiDate(asDate(from))} – ${formatThaiDate(asDate(to))}`;
}
