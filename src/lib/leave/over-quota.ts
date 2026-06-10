/**
 * Pure over-quota leave math. Shared by the worker-form preview, the admin
 * approval guard/freeze, and reports — one formula, three surfaces.
 *
 * Per-minute rate convention (matches the spec):
 *   Monthly: baseSalary / workingDaysPerMonth (PayrollConfig) / stdDayMinutes (LeaveConfig)
 *   Daily:   baseSalary / stdDayMinutes
 *   Hourly:  baseSalary / 60
 */

export type SalaryType = 'Monthly' | 'Daily' | 'Hourly';

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

/** Baht value of the over-quota minutes, rounded to satang (2dp). */
export function deductionForOverQuota(overQuotaMinutes: number, ratePerMinute: number): number {
  return Math.round(overQuotaMinutes * ratePerMinute * 100) / 100;
}
