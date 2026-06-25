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
 * Mirrors the per-approval freeze in leave/admin.ts, but applied as a batch so
 * frozen deductions can be refreshed to match an edited entitlement (used by the
 * recompute script). `ratePerMin` = the employee's per-minute over-quota rate
 * (perMinuteRate). Unlimited entitlement (grantedMinutes null) → never over.
 */
export function replayOverQuota(
  ent: ReplayEntitlement,
  requests: ReadonlyArray<{ id: string; chargedMinutes: number }>,
  ratePerMin: number,
): ReplayResult[] {
  const base =
    ent.grantedMinutes == null
      ? null
      : ent.grantedMinutes + ent.carryoverMinutes + ent.adjustmentMinutes;
  let used = 0;
  const out: ReplayResult[] = [];
  for (const r of requests) {
    const remaining = base == null ? null : base - used;
    const over = overQuotaMinutesFor(r.chargedMinutes, remaining);
    out.push({
      id: r.id,
      overQuotaMinutes: over,
      deductAmount: over > 0 ? deductionForOverQuota(over, ratePerMin) : null,
    });
    used += r.chargedMinutes;
  }
  return out;
}
