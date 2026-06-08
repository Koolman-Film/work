/**
 * Shared Bangkok-date helpers for attendance.
 *
 * Extracted from the verbatim copies that previously lived in live.ts,
 * check-in.ts, and the admin dashboard page. Pure + dependency-free so they
 * can be unit-tested without a DB or a request context.
 */

/**
 * Start-of-day in UTC for the Bangkok calendar date of `d`, matching how
 * Prisma stores `@db.Date` columns (UTC midnight). Uses the 'sv-SE' locale,
 * which renders YYYY-MM-DD, to extract the date part in Asia/Bangkok.
 */
export function bangkokDateUtcMidnight(d: Date): Date {
  const ymd = d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  return new Date(`${ymd}T00:00:00.000Z`);
}

/**
 * A "closed day" is one nobody is expected to check in on: a Sunday, or a
 * day with an active Holiday row. `date` must be a UTC-midnight @db.Date
 * value (as produced by `bangkokDateUtcMidnight`), so `getUTCDay()` reads the
 * Bangkok weekday correctly.
 */
export function isClosedDay(date: Date, hasHoliday: boolean): boolean {
  return date.getUTCDay() === 0 || hasHoliday;
}
