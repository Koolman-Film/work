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
