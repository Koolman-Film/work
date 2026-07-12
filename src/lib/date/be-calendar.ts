import { buildMonthGrid } from '@/lib/leave/team-calendar-shape';

export type ISODate = string; // 'YYYY-MM-DD'
export type DayCell = {
  iso: ISODate;
  day: number;
  inMonth: boolean;
  today: boolean;
  disabled: boolean;
};

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseISO(s: string): { year: number; month0: number; day: number } | null {
  const m = ISO_RE.exec(s);
  if (!m) return null;
  const year = Number(m[1]);
  const month1 = Number(m[2]);
  const day = Number(m[3]);
  if (month1 < 1 || month1 > 12 || day < 1 || day > 31) return null;
  return { year, month0: month1 - 1, day };
}

export function beYear(gregorianYear: number): number {
  return gregorianYear + 543;
}

export function isDisabled(iso: ISODate, min?: ISODate, max?: ISODate): boolean {
  if (min && iso < min) return true;
  if (max && iso > max) return true;
  return false;
}

export function clampRange(from: ISODate, to: ISODate): { from: ISODate; to: ISODate } {
  return to < from ? { from: to, to: from } : { from, to };
}

export function shiftMonth0(
  year: number,
  month0: number,
  delta: number,
): { year: number; month0: number } {
  const total = year * 12 + month0 + delta;
  return { year: Math.floor(total / 12), month0: ((total % 12) + 12) % 12 };
}

/**
 * A month's 6×7 grid as DayCells. Composes team-calendar-shape's buildMonthGrid
 * (ISO-safe, Sunday-first, includes leading/trailing pad) and layers today +
 * min/max disabling. `today` is injected for deterministic tests.
 */
export function buildDayGrid(
  year: number,
  month0: number,
  opts?: { min?: ISODate; max?: ISODate; today?: ISODate },
): DayCell[] {
  return buildMonthGrid(year, month0).map((g) => ({
    iso: g.date,
    day: g.day,
    inMonth: g.inMonth,
    today: opts?.today === g.date,
    disabled: isDisabled(g.date, opts?.min, opts?.max),
  }));
}
