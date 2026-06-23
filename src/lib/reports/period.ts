/** Report period resolution: ?m=YYYY-MM (month mode, default current Bangkok
 *  month) or ?from=YYYY-MM-DD&to=YYYY-MM-DD (custom range, month=null).
 *  Pure — callers pass today's Bangkok YYYY-MM-DD. */

import { payrollMonthWindowYmd } from '@/lib/payroll/period';

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const YM = /^\d{4}-\d{2}$/;

/** True iff the string is a real calendar date (no JS rollover, no Invalid Date).
 *  Belt-and-braces: round-trip via ISO string to catch both NaN and silent
 *  day-overflows (JS Date does NOT roll over ISO date strings — they yield
 *  Invalid Date — but the startsWith check guards future-proof). */
function isValidYmd(s: string): boolean {
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

/** True iff YYYY-MM is a real month (01–12). */
function isValidYm(ym: string): boolean {
  return isValidYmd(`${ym}-01`);
}

export type ReportPeriod = { from: string; to: string; month: string | null };

/** Split a validated "YYYY-MM" into numeric year/month. */
function splitYm(ym: string): [number, number] {
  return [Number(ym.slice(0, 4)), Number(ym.slice(5, 7))];
}

function monthBounds(ym: string): { from: string; to: string } {
  const [y, m] = splitYm(ym);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
}

export function resolveReportPeriod(
  params: { m?: string; from?: string; to?: string },
  todayYmd: string,
  /** Payroll cutoff day — when provided, month mode aligns to the payroll
   *  cutoff window (C8) so report counts tie out with payroll deductions.
   *  Omitted → plain calendar month (1st→last). Custom from/to ignores it. */
  cutoffDay?: number,
): ReportPeriod {
  const { from, to, m } = params;
  if (
    from &&
    to &&
    YMD.test(from) &&
    YMD.test(to) &&
    isValidYmd(from) &&
    isValidYmd(to) &&
    from <= to
  ) {
    return { from, to, month: null };
  }
  const ym = m && YM.test(m) && isValidYm(m) ? m : todayYmd.slice(0, 7);
  const bounds =
    cutoffDay != null && cutoffDay >= 1 && cutoffDay <= 28
      ? payrollMonthWindowYmd(ym, cutoffDay)
      : monthBounds(ym);
  return { ...bounds, month: ym };
}

/** prev/next month strings for the picker ("2026-06" → "2026-05"/"2026-07"). */
export function adjacentMonths(ym: string): { prev: string; next: string } {
  const [y, m] = splitYm(ym);
  const fmt = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, '0')}`;
  return {
    prev: m === 1 ? fmt(y - 1, 12) : fmt(y, m - 1),
    next: m === 12 ? fmt(y + 1, 1) : fmt(y, m + 1),
  };
}
