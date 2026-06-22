import { intervalToDuration } from 'date-fns';

/** Calendar length-of-service, broken into whole years / months / days. */
export type Tenure = { years: number; months: number; days: number };

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Parse a YYYY-MM-DD string to a UTC-midnight Date, or null if malformed. */
function parseYmdUtc(ymd: string): Date | null {
  if (!YMD.test(ymd)) return null;
  const d = new Date(`${ymd}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Calendar Y/M/D breakdown of service length from `startYmd` to `todayYmd`
 * (both YYYY-MM-DD). Returns null when either date is malformed or the start
 * is in the future (employee hasn't started yet).
 *
 * Anchored at UTC midnight so the result is DST-proof and depends only on the
 * calendar dates. `intervalToDuration` handles the awkward month-length
 * borrowing (e.g. Jan 31 → Mar 1) that a naive subtraction gets wrong.
 */
export function tenureBreakdown(startYmd: string, todayYmd: string): Tenure | null {
  const start = parseYmdUtc(startYmd);
  const today = parseYmdUtc(todayYmd);
  if (!start || !today || start.getTime() > today.getTime()) return null;
  const d = intervalToDuration({ start, end: today });
  return { years: d.years ?? 0, months: d.months ?? 0, days: d.days ?? 0 };
}

/** Thai "x ปี y เดือน z วัน" — always shows all three units per the spec. */
export function formatTenureThai(t: Tenure): string {
  return `${t.years} ปี ${t.months} เดือน ${t.days} วัน`;
}
