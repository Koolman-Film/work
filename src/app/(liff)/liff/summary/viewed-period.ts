/**
 * Derives the year/month actually being *viewed* from a resolved
 * `ReportPeriod` (see `@/lib/reports/period`).
 *
 * Before custom ranges existed, `period.month` was never null, so reading
 * "the current period's month" via a `?? todayYmd` fallback was dead code.
 * Now that custom ranges set `month: null`, that fallback silently lies —
 * it renders "today's month" while the report below shows a different
 * period entirely. This helper makes the derivation explicit and gives it
 * one unambiguous meaning that every call site can share.
 *
 * Pure — no dependency on `period.ts` internals, just its output shape.
 */

export type ViewedPeriod = {
  /** Calendar year of the period being viewed. */
  year: number;
  /** "YYYY-MM" of the period being viewed — `period.month` in month mode,
   *  or the range's start month in custom-range mode. */
  month: string;
};

export function viewedPeriod(period: { from: string; month: string | null }): ViewedPeriod {
  // Month mode: `period.month` IS the answer. Custom-range mode has no single
  // canonical month — a range can span two calendar years — so we anchor on
  // the range's start as the pragmatic choice. This only feeds single-year
  // concerns (leave balance window, month-nav labels); it does not attempt
  // multi-year leave aggregation.
  const month = period.month ?? period.from.slice(0, 7);
  // Year is derived FROM `month`, never independently from `period.from`, so
  // the two can't disagree by construction. This matters since /liff/summary
  // resolves month mode against the PAYROLL CUTOFF: month "2027-01" with
  // cutoffDay 26 starts on 2026-12-27, so `from`'s year is 2026 while the
  // month being viewed is January 2027. Reading the year off `from` there
  // would show the previous year's leave balance under a "2027" heading.
  return { year: Number(month.slice(0, 4)), month };
}
