/**
 * Earnings-so-far for Daily/Hourly employees, used as the advance cap
 * ("ไม่เกินเงินเดือน" — for rate-based staff "เงินเดือน" means what they have
 * actually earned this payroll period). Pure; callers fetch attendance.
 *
 * Payroll period = cutoffDay-based: (prevMonth cutoff+1) .. (thisMonth cutoff),
 * matching PayrollConfig.cutoffDay (default 25).
 */

import Decimal from 'decimal.js';

export type PayrollPeriod = { start: string; end: string }; // YYYY-MM-DD inclusive

export function payrollPeriodFor(todayYmd: string, cutoffDay: number): PayrollPeriod {
  const parts = todayYmd.split('-').map(Number);
  const y = parts[0]!;
  const m = parts[1]!;
  const d = parts[2]!;
  // Use UTC date arithmetic on day-precision values; no wall-clock involved.
  const afterCutoff = d > cutoffDay;
  const endMonth = afterCutoff ? m + 1 : m;
  const end = new Date(Date.UTC(y, endMonth - 1, cutoffDay));
  const start = new Date(Date.UTC(y, endMonth - 2, cutoffDay + 1));
  const ymd = (dt: Date) => dt.toISOString().slice(0, 10);
  return { start: ymd(start), end: ymd(end) };
}

export type WorkedRow = {
  date: Date; // UTC-midnight @db.Date value
  clockInAt: Date | null;
  clockOutAt: Date | null;
};

/** Daily → distinct worked dates × rate. Hourly → Σ(clockOut−clockIn) minutes
 *  / 60 × rate (open rows contribute 0). Result rounded to 2dp via decimal.js
 *  to match the payroll module's money-math convention (no IEEE-754 drift). */
export function periodEarnings(
  salaryType: 'Daily' | 'Hourly',
  rate: number,
  rows: readonly WorkedRow[],
): number {
  if (salaryType === 'Daily') {
    const dates = new Set(rows.map((r) => r.date.toISOString().slice(0, 10)));
    return new Decimal(dates.size).times(rate).toDecimalPlaces(2).toNumber();
  }
  let minutes = 0;
  for (const r of rows) {
    if (r.clockInAt && r.clockOutAt) {
      minutes += Math.max(0, (r.clockOutAt.getTime() - r.clockInAt.getTime()) / 60_000);
    }
  }
  return new Decimal(minutes).dividedBy(60).times(rate).toDecimalPlaces(2).toNumber();
}
