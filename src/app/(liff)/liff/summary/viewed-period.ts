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
  // `period.from` is always populated in both modes, so it's a safe source
  // for both fields. In month mode it's the 1st of `period.month`, so this
  // agrees with `period.month` exactly. In custom-range mode there is no
  // single canonical month/year — a range can span two calendar years — so
  // we anchor on the range's start as the pragmatic choice. This only feeds
  // single-year concerns (leave balance window, month-nav labels); it does
  // not attempt multi-year leave aggregation.
  return { year: Number(period.from.slice(0, 4)), month: period.month ?? period.from.slice(0, 7) };
}
