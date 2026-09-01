/**
 * Turns one payroll month's over-quota leave deduction into per-request lines,
 * so the payslip can say WHICH leave day the money was for.
 *
 * The complaint this answers: an employee sees "ลาเกินสิทธิ −฿450" beside a leave
 * balance that still shows days remaining, and nothing on the slip connects the
 * two. The charge is often from an EARLIER entitlement year — the balance is
 * computed for the year being viewed, while the payroll sweep collects
 * over-quota leave from any year — so a 2025 charge lands next to a healthy
 * 2026 balance with only minutes and a rate to explain itself.
 *
 * ## Why this reconciles instead of trusting the link
 *
 * The per-request rows come from `LeaveRequest.deductedInPayrollId`, which
 * `run.ts` stamps ONLY when a request is fully settled: stamping a partially
 * collected one would freeze it at the instalment and forgive the remainder.
 * That is right for money and incomplete for display — under a monthly cap
 * (`PayrollConfig.leaveDeductMaxPercent`) an instalment month collects real baht
 * from a request it never stamps, and the final month is stamped for the whole
 * request while collecting only what was left.
 *
 * Prod has never split a charge (the cap is 0, and every collected request is
 * stamped with `deductedAmountToDate == deductAmount`), so today the link is
 * exact. Turning the cap on would break that quietly. Rather than print a
 * breakdown whose parts do not add up to the total actually deducted, this
 * returns `null` and the caller falls back to the single aggregate line — the
 * slip loses detail it cannot stand behind, and never states something false.
 */

export type SweptLeaveCharge = {
  id: string;
  /** startDate as YYYY-MM-DD. */
  startDate: string;
  /** endDate as YYYY-MM-DD; equal to startDate for a single-day request. */
  endDate: string;
  /** Frozen over-quota minutes for this request. */
  overQuotaMinutes: number;
  /** Frozen baht for this request. */
  amount: number;
  /** Raw name data — localized by the renderer, never here (see types.ts). */
  leaveType: { name: string; nameByLocale: unknown } | null;
};

/** Baht compare at the 2dp the column stores, so float noise never trips it. */
const cents = (n: number) => Math.round(n * 100);

/**
 * The per-request lines to show, or `null` to fall back to one aggregate line.
 *
 * `null` when there is nothing to itemise, or when the parts do not sum to
 * `frozenTotal` — the authoritative amount on the payroll row.
 */
export function itemiseLeaveCharges(
  charges: readonly SweptLeaveCharge[],
  frozenTotal: number,
): SweptLeaveCharge[] | null {
  if (charges.length === 0) return null;
  // Mirror the aggregate line's rule: a zero bucket shows no leave line at all.
  // Without this a ฿0 stamped request — a fully waived charge, say — would put
  // "ลาเกินสิทธิ · ลากิจ 5 กันยายน 2569  −฿0.00" on a slip that deducted nothing
  // for leave, which reads as a charge. Prod has none today; the payslip should
  // not depend on that staying true.
  if (cents(frozenTotal) === 0) return null;
  const sum = charges.reduce((s, c) => s + cents(c.amount), 0);
  if (sum !== cents(frozenTotal)) return null;
  // Chronological: the slip reads as a story of the period, and an old backlog
  // charge sorts to the top where its date is the first thing seen.
  return [...charges].sort(
    (a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id),
  );
}
