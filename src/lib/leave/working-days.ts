/**
 * Working-day expansion for leave requests.
 *
 * Pure function — given a start..end inclusive date range (calendar) and a
 * set of holidays for the relevant year, returns every working day in the
 * range. Used by:
 *   - LIFF leave form: show "this is 5 working days" preview to the
 *     employee before they submit.
 *   - Admin approval: expand the request into Attendance(OnLeave) rows,
 *     one per working day.
 *
 * "Working day" definition (single source of truth for v1):
 *   - Exclude Sundays. (Koolman's standard week is Mon–Sat.)
 *   - Exclude any date marked as a Holiday in the Holiday table.
 *
 * The Sunday rule is hardcoded for now; the requirement.docx never spelled
 * out alternative work-week patterns. If the customer adopts a different
 * schedule later (e.g., Mon–Fri stores), this becomes per-Employee via
 * WorkSchedule and we delete the const.
 *
 * Dates are handled as UTC midnight (Prisma's @db.Date semantic) — never
 * shift timezones inside this function, callers must pass in dates that
 * already represent calendar-day-in-Bangkok.
 */

export type CalendarDate = Date;

/**
 * Day-of-week constant for the closed-by-default day. 0 = Sunday in JS
 * (matches `Date.getUTCDay()` since we use UTC-midnight Dates).
 */
const CLOSED_DOW = 0; // Sunday

/**
 * Compares two dates by Y-M-D only (in UTC). Returns true if they refer
 * to the same calendar day. Defensive against caller-supplied timestamps
 * not normalised to midnight.
 */
function sameDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

/**
 * Expand a [startDate, endDate] inclusive range into the working days
 * within it. Excludes Sundays + holidays.
 *
 * Returns an empty array if endDate < startDate (caller's responsibility
 * to validate, but we don't crash).
 */
export function workingDaysIn(args: {
  startDate: Date;
  endDate: Date;
  holidays: readonly Date[];
}): CalendarDate[] {
  const out: Date[] = [];
  const start = new Date(
    Date.UTC(
      args.startDate.getUTCFullYear(),
      args.startDate.getUTCMonth(),
      args.startDate.getUTCDate(),
    ),
  );
  const end = new Date(
    Date.UTC(args.endDate.getUTCFullYear(), args.endDate.getUTCMonth(), args.endDate.getUTCDate()),
  );

  for (let d = start; d.getTime() <= end.getTime(); d = new Date(d.getTime() + 86_400_000)) {
    if (d.getUTCDay() === CLOSED_DOW) continue; // Sunday — closed
    if (args.holidays.some((h) => sameDay(h, d))) continue; // Holiday
    out.push(new Date(d.getTime()));
  }

  return out;
}

/**
 * Augment a holiday list with auto-computed substitute days.
 *
 * Thai labor law: when a public holiday falls on a non-working day, the
 * worker is entitled to the next working day as a substitute holiday
 * ("วันหยุดชดเชย"). In our schema the only non-working weekday is Sunday
 * (CLOSED_DOW), so this function adds the Monday-after for any Sunday
 * holiday.
 *
 * Dedup by date-string: if admin already added the substitute manually
 * via /admin/settings/holidays, we don't double-count it. So this is a
 * safe addition — manual entries always win on order (they come first
 * in the input array and are seen first).
 *
 * The function returns a NEW array; the input is not mutated.
 */
export function expandHolidaysWithSubstitutes(holidays: readonly Date[]): Date[] {
  const seen = new Set<string>();
  const out: Date[] = [];
  function add(d: Date) {
    const key = d.toISOString().slice(0, 10);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(d);
  }
  for (const h of holidays) {
    add(h);
    if (h.getUTCDay() === CLOSED_DOW) {
      // Substitute = next day (we already know it's not a Sunday since
      // CLOSED_DOW is Sunday and we're moving +1). If the substitute
      // ALSO happens to be on a Holiday row (rare edge case — e.g.,
      // 2-day public holiday spanning Sun+Mon), the dedup handles it.
      add(new Date(h.getTime() + 86_400_000));
    }
  }
  return out;
}

/**
 * Parse a YYYY-MM-DD string (what `<input type=date>` emits) into a UTC-
 * midnight Date suitable for storage in a Prisma `@db.Date` column.
 *
 * Returns null if the string doesn't parse as a valid date. Validation
 * lives here so the actions layer doesn't need to know about ISO-8601
 * subtleties.
 */
export function parseInputDate(raw: string): Date | null {
  // Reject anything that isn't exactly YYYY-MM-DD — browsers may sometimes
  // emit YYYY-MM-DD'T00:00, but we want strict input shape.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;

  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;

  // Round-trip check: re-format and compare. Catches inputs like
  // "2026-02-30" that `new Date()` would silently roll over to March 2.
  const reformatted = date.toISOString().slice(0, 10);
  if (reformatted !== raw) return null;

  return date;
}
