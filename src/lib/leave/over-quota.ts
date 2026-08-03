/**
 * Pure over-quota leave math. Shared by the worker-form preview, the admin
 * approval guard/freeze, and reports — one formula, three surfaces.
 *
 * Per-minute rate convention (matches the spec):
 *   Monthly: baseSalary / workingDaysPerMonth (PayrollConfig) / stdDayMinutes (LeaveConfig)
 *   Daily:   baseSalary / stdDayMinutes
 *   Hourly:  baseSalary / 60
 */

import Decimal from 'decimal.js';

export type SalaryType = 'Monthly' | 'Daily' | 'Hourly';

/** Callers validate inputs upstream; workingDaysPerMonth/stdDayMinutes of 0
 *  yields Infinity/NaN by design — this helper does not guard. */
export function perMinuteRate(
  salaryType: SalaryType,
  baseSalary: number,
  workingDaysPerMonth: number,
  stdDayMinutes: number,
): number {
  switch (salaryType) {
    case 'Monthly':
      return baseSalary / workingDaysPerMonth / stdDayMinutes;
    case 'Daily':
      return baseSalary / stdDayMinutes;
    case 'Hourly':
      return baseSalary / 60;
  }
}

/** Minutes of `chargedMinutes` that exceed the year entitlement.
 *  `remaining` null = unlimited quota → never over. Negative remaining
 *  (historical over-approval) clamps to 0 so the deduction never
 *  retro-charges previous requests. */
export function overQuotaMinutesFor(chargedMinutes: number, remaining: number | null): number {
  if (remaining == null) return 0;
  return Math.max(0, chargedMinutes - Math.max(0, remaining));
}

/** Baht value of the over-quota minutes, rounded to satang (2dp).
 *  Computed via decimal.js to match the payroll module's money-math
 *  convention (no IEEE-754 drift in the multiply/round step); returns a
 *  plain number because the value is frozen once into Decimal(12,2). */
export function deductionForOverQuota(overQuotaMinutes: number, ratePerMinute: number): number {
  return new Decimal(overQuotaMinutes).times(ratePerMinute).toDecimalPlaces(2).toNumber();
}

export type ReplayEntitlement = {
  /** null = unlimited (never over quota). */
  grantedMinutes: number | null;
  carryoverMinutes: number;
  adjustmentMinutes: number;
  /** Minutes consumed by attendance-penalty settlements against this leave
   *  type/year (penalty-minutes.ts). REQUIRED, not optional with a zero
   *  default — same reasoning as remainingMinutes' `penalty` parameter
   *  (balance.ts): an optional field lets a construction site be missed, and
   *  a missed site silently reports too much headroom, which is exactly the
   *  bug this field exists to close. A required field turns a missed site
   *  into a compile error instead of a silent money leak. */
  penaltyMinutes: number;
};

export type ReplayResult = {
  id: string;
  overQuotaMinutes: number;
  deductAmount: number | null;
};

/**
 * Recompute over-quota for one (employee, leaveType, year) against the CURRENT
 * entitlement, in order. Over-quota is ORDER-DEPENDENT: each request's over-
 * quota is measured against the entitlement remaining AFTER all earlier
 * requests in `requests` (which MUST already be sorted — approval/start order).
 *
 * `ent.penaltyMinutes` (attendance penalties settled with leave) is subtracted
 * from `base` BEFORE the walk, not interleaved into the per-request loop. A
 * penalty settlement has no position in the approval sequence — it isn't a
 * leave request — so there is no principled point at which to "insert" it
 * into the walk. Taking it off the top of `base` instead means it reduces
 * headroom uniformly for every request, which is exactly how
 * `remainingMinutes` (balance.ts) treats it: `granted + carryover +
 * adjustment − used − penalty`. The two formulas must agree — this is the
 * whole point of this function existing (see recompute.ts's module doc) — so
 * this mirrors that formula's grouping rather than trying to charge the
 * penalty against a specific request.
 *
 * Mirrors the per-approval freeze in leave/admin.ts, but applied as a batch so
 * frozen deductions can be refreshed to match an edited entitlement (used by the
 * recompute script). `ratePerMin` = the employee's per-minute over-quota rate
 * (perMinuteRate). Unlimited entitlement (grantedMinutes null) → never over,
 * regardless of `penaltyMinutes` (unlimited quota has no headroom to reduce).
 */
export function replayOverQuota(
  ent: ReplayEntitlement,
  requests: ReadonlyArray<{
    id: string;
    chargedMinutes: number;
    /** Over-quota minutes an admin chose not to charge (0 = charge in full).
     *
     *  REQUIRED, not optional-with-default, for the same reason as
     *  `ReplayEntitlement.penaltyMinutes`: this function is the single money
     *  formula and has four callers, one of which is a CLI script with
     *  `--apply` that writes to the real database. An optional field lets a
     *  caller be missed, and a missed caller silently re-charges a deduction a
     *  human deliberately forgave. Required turns that into a compile error. */
    waivedOverQuotaMinutes: number;
  }>,
  ratePerMin: number,
): ReplayResult[] {
  const base =
    ent.grantedMinutes == null
      ? null
      : ent.grantedMinutes + ent.carryoverMinutes + ent.adjustmentMinutes - ent.penaltyMinutes;
  let used = 0;
  const out: ReplayResult[] = [];
  for (const r of requests) {
    const remaining = base == null ? null : base - used;
    const over = overQuotaMinutesFor(r.chargedMinutes, remaining);
    // The waiver reduces what is CHARGED, never what was USED. The employee
    // still took the leave, so it still consumes quota and still pushes later
    // requests over — forgiving the money must not hand back the days, or a
    // waiver would silently make every subsequent request cheaper too.
    const chargeable = Math.max(0, over - Math.max(0, r.waivedOverQuotaMinutes));
    out.push({
      id: r.id,
      // Factual: how far over quota this request actually was. Kept whole so
      // the waiver stays visible as a separate decision rather than erasing it.
      overQuotaMinutes: over,
      deductAmount: chargeable > 0 ? deductionForOverQuota(chargeable, ratePerMin) : null,
    });
    used += r.chargedMinutes;
  }
  return out;
}
