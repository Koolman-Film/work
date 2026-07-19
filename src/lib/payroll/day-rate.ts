import Decimal from 'decimal.js';

/**
 * What one day of an employee's pay is worth, for attendance deductions.
 *
 * The customer specifies penalties in DAYS ("หักเงินหรือสิทธิ 1 วัน"), never in
 * baht. Before this, everyone lost the same flat ฿500 whatever they earned,
 * which over-charged 32 of 46 people on production — hardest on the lowest
 * paid, since a fixed amount is a bigger share of a smaller wage. Someone on
 * ฿10,000 lost ฿500 for a day actually worth ฿333.
 *
 * Monthly's divisor is `PayrollConfig.workingDaysPerMonth` — the same number
 * leave over-quota (over-quota.ts) and OT (overtime/rate.ts) already use to
 * answer "what is one day of a monthly salary worth". Passing it through
 * here (rather than a second hardcoded 30) is what keeps a leave-day and an
 * absence-day priced the same way on one payslip.
 *
 * Falls back to the configured flat `fallbackPerDay` — not a guess — for
 * Hourly employees (no standard hours-per-day exists in the system) and for
 * a zero/negative base salary. It does NOT protect against a missing or
 * non-numeric `baseSalary`: that goes straight into `new Decimal(...)`,
 * which throws. Callers are expected to pass a real employee record; there
 * is no silent fallback for malformed input.
 */

export const DEFAULT_DAYS_PER_MONTH = 30;

export type DayRateEmployee = {
  salaryType: 'Monthly' | 'Daily' | 'Hourly';
  baseSalary: string | number | Decimal;
};

// Matches calc.ts's toDec convention exactly: calc.ts doesn't export this
// helper, so it's duplicated here rather than inventing a different
// string/number/Decimal conversion.
function toDec(v: string | number | Decimal): Decimal {
  return v instanceof Decimal ? v : new Decimal(v);
}

/**
 * A zero, negative, missing, or non-finite `workingDaysPerMonth` falls back
 * to `DEFAULT_DAYS_PER_MONTH` rather than producing Infinity (÷0), a flipped
 * sign (÷ negative), or a throw — a bad admin-entered value in
 * `PayrollConfig` must never corrupt every Monthly employee's payslip.
 */
function resolveDivisor(workingDaysPerMonth: number | null | undefined): number {
  if (
    typeof workingDaysPerMonth === 'number' &&
    Number.isFinite(workingDaysPerMonth) &&
    workingDaysPerMonth > 0
  ) {
    return workingDaysPerMonth;
  }
  return DEFAULT_DAYS_PER_MONTH;
}

export function dailyRateFor(
  employee: DayRateEmployee,
  fallbackPerDay: string | number | Decimal,
  /** `PayrollConfig.workingDaysPerMonth`. Omit to use the 30-day default. */
  workingDaysPerMonth?: number | null,
): Decimal {
  const base = toDec(employee.baseSalary);
  const fallback = toDec(fallbackPerDay);

  if (!base.isFinite() || base.lte(0)) return fallback;

  switch (employee.salaryType) {
    case 'Monthly':
      return base.dividedBy(resolveDivisor(workingDaysPerMonth));
    case 'Daily':
      // baseSalary IS the day rate here — dividing would be an order-of-
      // magnitude error (฿450 → ฿15).
      return base;
    default:
      // Hourly: the system stores no standard hours-per-day, so any divisor
      // would be invented. Defer to the admin-set figure.
      return fallback;
  }
}
