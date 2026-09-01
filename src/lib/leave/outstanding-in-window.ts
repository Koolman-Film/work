/**
 * How much over-quota leave is still owed for ONE payroll period.
 *
 * `computeLiveLeaveCharges` (recompute.ts) deliberately has NO lower date bound:
 * it remembers the entire backlog so payroll can still collect a charge that was
 * never swept. That is correct for payroll and wrong for anything asking "what
 * comes out of THIS month's pay" — the advance cap in particular, where folding
 * in an all-time backlog gives anyone carrying one a permanently negative
 * balance (§A0.2, the ฿27,450 case).
 *
 * So the window is applied HERE, to the RESULT, and never to the query that
 * produced it. That distinction is load-bearing: `computeLiveLeaveCharges`
 * groups by (employee, leaveType, year) and replays the year in approval order
 * to decide which requests exceeded the quota — earlier requests consume it
 * first. Filtering its query by date would hide those earlier requests and make
 * a later one look under quota, understating or erasing a real deduction.
 * Filter after the replay and every charge keeps the amount payroll would use.
 *
 * Pure, so the fast unit suite can reach it — recompute.ts is `server-only`.
 */

/** The fields of a `LiveLeaveCharge` this needs. Structural on purpose so the
 *  unit suite never has to import the server-only module that produces them. */
export type OutstandingCharge = {
  /** startDate as YYYY-MM-DD. */
  date: string;
  /** Already collected into a published payroll — locked, never collected twice. */
  swept: boolean;
  deductAmount: number | null;
  /** Baht already collected across earlier months when a cap split the charge. */
  deductedAmountToDate: number;
};

/**
 * Sum of what is still owed for leave dated within `[fromYmd, toYmd]` inclusive.
 *
 * Both bounds are inclusive because a payroll period is inclusive at both ends
 * (`payrollMonthWindowYmd`), and YYYY-MM-DD strings compare correctly with `<=`.
 */
export function outstandingLeaveInWindow(
  charges: readonly OutstandingCharge[],
  fromYmd: string,
  toYmd: string,
): number {
  let total = 0;
  for (const c of charges) {
    if (c.swept) continue;
    if (c.date < fromYmd || c.date > toYmd) continue;
    // A null deductAmount means nothing was charged (e.g. fully waived), not
    // "unknown" — treat it as zero rather than letting NaN poison the sum.
    const owed = (c.deductAmount ?? 0) - c.deductedAmountToDate;
    // Never negative: over-collection would otherwise RAISE the advance cap,
    // handing back borrowing power on the strength of a bookkeeping error.
    if (owed > 0) total += owed;
  }
  return total;
}
