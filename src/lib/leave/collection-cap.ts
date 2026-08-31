/**
 * How much over-quota leave may be recovered from ONE payroll month.
 *
 * The payroll sweep has no lower date bound — every approved over-quota leave
 * request that was never swept into a published payroll is charged, however
 * old. Remembering the debt is right; collecting ALL of it in whichever month
 * runs next is not. That is how a ฿13,500 salary met a ฿27,450 deduction and
 * produced a net of −฿14,625 (2026-08-03).
 *
 * The negative-net publish guard catches that, but only by making the row
 * unpublishable — containment, not a fix. A cap turns the same debt into
 * instalments: the payslip stays positive, the company still recovers in full,
 * and the employee can predict their pay.
 *
 * Pure. Money is rounded to satang with decimal.js, matching the payroll
 * module's convention.
 */

import Decimal from 'decimal.js';

const satang = (n: Decimal) => n.toDecimalPlaces(2).toNumber();

/**
 * The month's ceiling in baht, or null for "no cap".
 *
 * `null` and `0` are deliberately different. A percentage of 0 means the
 * feature is OFF — collect everything, the behaviour before this existed. If 0
 * meant "collect nothing", clearing the field would silently halt all leave
 * recovery, and nothing would report it. A zero or unknown salary also yields
 * null: we cannot compute a meaningful ceiling, and guessing one would be worse
 * than not capping.
 */
export function monthlyLeaveCap(baseSalary: number, maxPercent: number): number | null {
  if (!Number.isFinite(baseSalary) || baseSalary <= 0) return null;
  if (!Number.isFinite(maxPercent) || maxPercent <= 0) return null;
  return satang(new Decimal(baseSalary).times(maxPercent).dividedBy(100));
}

export type OutstandingRequest = { id: string; outstanding: number };

export type LeaveCollection = {
  id: string;
  /** Baht to charge THIS month. May be less than `outstanding`. */
  collect: number;
  /** True when this collection clears the request. Only then may the caller
   *  stamp `deductedInPayrollId` — a partially collected request must stay
   *  sweepable, or the remainder is silently forgiven. */
  fullySettled: boolean;
};

/**
 * Fill the month's cap from the outstanding requests, in the order given
 * (the caller supplies approval order).
 *
 * A request that straddles the ceiling is SPLIT. Collecting only whole requests
 * would deadlock on any single request larger than the cap — it would be
 * skipped every month, forever, which is exactly the shape of the case that
 * prompted this.
 *
 * `cap` of null means no ceiling; 0 means collect nothing this month.
 */
export function capLeaveCollection(
  requests: ReadonlyArray<OutstandingRequest>,
  cap: number | null,
): LeaveCollection[] {
  const out: LeaveCollection[] = [];
  let remaining = cap;

  for (const r of requests) {
    // Never negative: an over-collected row (a waiver applied after money was
    // taken, say) must not claw funds back out of a payslip.
    if (!Number.isFinite(r.outstanding) || r.outstanding <= 0) continue;
    if (remaining != null && remaining <= 0) break;

    const take = remaining == null ? r.outstanding : Math.min(r.outstanding, remaining);
    const collect = satang(new Decimal(take));
    if (collect <= 0) break;

    out.push({ id: r.id, collect, fullySettled: collect >= r.outstanding });
    if (remaining != null) remaining = satang(new Decimal(remaining).minus(collect));
  }
  return out;
}
