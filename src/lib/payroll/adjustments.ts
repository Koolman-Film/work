/**
 * Month-window selection for PayrollAdjustment rows.
 *
 * An adjustment applies to pay-period month M iff
 *   startMonth <= M <= (endMonth ?? ∞)
 * Plain string comparison is correct because YYYY-MM is lexicographically
 * ordered. Selection-by-range (rather than sweep-and-stamp) makes draft
 * recalculation idempotent — re-running the same month re-selects the same
 * rows instead of double-applying.
 *
 * Frequency mapping (UI → storage):
 *   one-time   → startMonth == endMonth
 *   monthly    → endMonth = null
 *   date-range → startMonth < endMonth
 */

export type AdjustmentWindow = {
  startMonth: string;
  endMonth: string | null;
};

export function adjustmentAppliesToMonth(a: AdjustmentWindow, month: string): boolean {
  return a.startMonth <= month && (a.endMonth === null || month <= a.endMonth);
}
