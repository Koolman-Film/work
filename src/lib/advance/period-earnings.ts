/**
 * Earnings-so-far for Daily/Hourly employees, used as the advance cap
 * ("ไม่เกินเงินเดือน" — for rate-based staff "เงินเดือน" means what they have
 * actually earned this payroll period). Pure; callers fetch attendance.
 *
 * Payroll period = cutoffDay-based: (prevMonth cutoff+1) .. (thisMonth cutoff),
 * matching PayrollConfig.cutoffDay (default 25).
 *
 * Perf: 3-4 queries per call — fine for form/approval; report code must NOT
 * loop this over all employees (reports use their own aggregations).
 */

import Decimal from 'decimal.js';

export type PayrollPeriod = { start: string; end: string }; // YYYY-MM-DD inclusive

export function payrollPeriodFor(todayYmd: string, cutoffDay: number): PayrollPeriod {
  // Guard: Date.UTC silently rolls cutoff-31 periods into overlapping ranges —
  // fail loud so misconfigured PayrollConfig.cutoffDay is caught early.
  if (!Number.isInteger(cutoffDay) || cutoffDay < 1 || cutoffDay > 28)
    throw new Error(`payrollPeriodFor: cutoffDay must be 1–28, got ${cutoffDay}`);

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
 *  to match the payroll module's money-math convention (no IEEE-754 drift).
 *
 *  For Hourly, pass `maxMinutesByDow` to bound creditable minutes per day
 *  (UTC day-of-week, 0=Sun..6=Sat). This caps forced-checkout inflation: an
 *  EOD job force-closes open check-ins at 22:00 Bangkok, so raw
 *  clockOut−clockIn can credit ~14h for a forgotten checkout. Clamping to the
 *  scheduled shift length bounds that inflation — this is a cap calculation,
 *  so over-crediting loosens the limit in the employee's favour. */
export function periodEarnings(
  salaryType: 'Daily' | 'Hourly',
  rate: number,
  rows: readonly WorkedRow[],
  maxMinutesByDow?: Partial<Record<number, number>>,
): number {
  if (salaryType === 'Daily') {
    const dates = new Set(rows.map((r) => r.date.toISOString().slice(0, 10)));
    return new Decimal(dates.size).times(rate).toDecimalPlaces(2).toNumber();
  }

  // Sum minutes per date first, then clamp each date if a limit is available.
  const minutesByDate = new Map<string, number>();
  for (const r of rows) {
    if (r.clockInAt && r.clockOutAt) {
      const dateKey = r.date.toISOString().slice(0, 10);
      const mins = Math.max(0, (r.clockOutAt.getTime() - r.clockInAt.getTime()) / 60_000);
      minutesByDate.set(dateKey, (minutesByDate.get(dateKey) ?? 0) + mins);
    }
  }

  let totalMinutes = 0;
  for (const [dateKey, mins] of minutesByDate) {
    if (maxMinutesByDow !== undefined) {
      const dow = new Date(`${dateKey}T00:00:00.000Z`).getUTCDay();
      const cap = maxMinutesByDow[dow];
      totalMinutes += cap !== undefined ? Math.min(mins, cap) : mins;
    } else {
      totalMinutes += mins;
    }
  }

  return new Decimal(totalMinutes).dividedBy(60).times(rate).toDecimalPlaces(2).toNumber();
}
