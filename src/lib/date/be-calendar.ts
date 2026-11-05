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

/** Order of day / month / year in a locale's short numeric date. */
export type DateOrder = 'dmy' | 'mdy' | 'ymd';

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

/**
 * Parse a date the user TYPED into a DateField, in the same field order the
 * field displays (`order`). Returns ISO "YYYY-MM-DD", or null when the text is
 * not a real calendar date.
 *
 * Accepts any non-digit separator ("27/04/2537", "27-4-2537", "27.04.2537")
 * or a bare 8-digit run ("27042537"), and Thai digits. The year must be four
 * digits — a two-digit year is refused rather than guessed, because a wrong
 * century on a birth date is silent. A year of 2400 or more is a Buddhist-era
 * year and is converted (−543): Thai admins type BE, the field shows BE, and
 * no CE date this app handles is anywhere near 2400.
 */
export function parseTypedDate(text: string, order: DateOrder): ISODate | null {
  const latin = text.trim().replace(/[๐-๙]/g, (c) => String(THAI_DIGITS.indexOf(c)));
  if (latin === '') return null;

  let parts: string[];
  if (/^\d{8}$/.test(latin)) {
    parts =
      order === 'ymd'
        ? [latin.slice(0, 4), latin.slice(4, 6), latin.slice(6, 8)]
        : [latin.slice(0, 2), latin.slice(2, 4), latin.slice(4, 8)];
  } else {
    parts = latin.split(/\D+/).filter(Boolean);
  }
  if (parts.length !== 3) return null;

  const [a, b, c] = parts as [string, string, string];
  const [dStr, mStr, yStr] = order === 'dmy' ? [a, b, c] : order === 'mdy' ? [b, a, c] : [c, b, a];
  if (!/^\d{4}$/.test(yStr) || dStr.length > 2 || mStr.length > 2) return null;

  let year = Number(yStr);
  if (year >= 2400) year -= 543;
  const month1 = Number(mStr);
  const day = Number(dStr);
  if (month1 < 1 || month1 > 12 || day < 1) return null;
  const daysInMonth = new Date(Date.UTC(year, month1, 0)).getUTCDate();
  if (day > daysInMonth) return null;

  return `${String(year).padStart(4, '0')}-${String(month1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
