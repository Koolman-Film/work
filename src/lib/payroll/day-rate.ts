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
 * Falls back to the configured flat amount rather than guessing whenever the
 * salary cannot produce a sane daily figure. The fallback stays
 * admin-editable, which the customer asked for explicitly.
 */

export const DAYS_PER_MONTH = 30;

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

export function dailyRateFor(
  employee: DayRateEmployee,
  fallbackPerDay: string | number | Decimal,
): Decimal {
  const base = toDec(employee.baseSalary);
  const fallback = toDec(fallbackPerDay);

  if (!base.isFinite() || base.lte(0)) return fallback;

  switch (employee.salaryType) {
    case 'Monthly':
      return base.dividedBy(DAYS_PER_MONTH);
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
