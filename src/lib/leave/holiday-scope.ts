/**
 * Which holidays apply to whom.
 *
 * A Holiday row with an empty `branchIds` is a company holiday — every branch,
 * the only kind that existed before. A row listing branches is a day off for
 * those branches only (a branch closed on 31 Dec while the rest work), matched
 * on the employee's HOME branch (`Employee.branchId`), the same key the payroll
 * cut-off uses.
 *
 * Every reader that decides "is this a working day for this employee" must go
 * through here: an unfiltered holiday list would excuse absences and lateness
 * at the branches that are open that day.
 *
 * Substitute days (`expandHolidaysWithSubstitutes`, a public holiday on Sunday
 * moves to Monday) apply to company holidays only. A branch closure is not a
 * public holiday; one falling on Sunday gives no Monday off.
 */
import { expandHolidaysWithSubstitutes } from './working-days';

export type ScopedHoliday = { date: Date; branchIds: readonly string[] };

/** Prisma `select` for the fields this module needs. */
export const HOLIDAY_SCOPE_SELECT = { date: true, branchIds: true } as const;

export function isCompanyHoliday(h: { branchIds: readonly string[] }): boolean {
  return h.branchIds.length === 0;
}

export function holidayAppliesToBranch(
  h: { branchIds: readonly string[] },
  branchId: string,
): boolean {
  return isCompanyHoliday(h) || h.branchIds.includes(branchId);
}

/**
 * Holiday dates that are days off for a branch: company holidays expanded with
 * their substitutes, plus that branch's own closures (not expanded).
 */
export function holidayDatesForBranch(
  holidays: readonly ScopedHoliday[],
  branchId: string,
): Date[] {
  const company = expandHolidaysWithSubstitutes(
    holidays.filter(isCompanyHoliday).map((h) => h.date),
  );
  const seen = new Set(company.map(ymd));
  const out = [...company];
  for (const h of holidays) {
    if (isCompanyHoliday(h) || !h.branchIds.includes(branchId)) continue;
    const key = ymd(h.date);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h.date);
  }
  return out;
}

/**
 * Memoised per-branch YYYY-MM-DD sets, for loops over many employees (payroll
 * run, absence preview).
 */
export function holidayYmdLookup(
  holidays: readonly ScopedHoliday[],
): (branchId: string) => Set<string> {
  const cache = new Map<string, Set<string>>();
  return (branchId) => {
    let set = cache.get(branchId);
    if (!set) {
      set = new Set(holidayDatesForBranch(holidays, branchId).map(ymd));
      cache.set(branchId, set);
    }
    return set;
  };
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
