import Decimal from 'decimal.js';
import { minutesOf } from '@/lib/leave/units';

export type OtRateType = 'PerHourAmount' | 'Multiplier';
export type SalaryType = 'Monthly' | 'Daily' | 'Hourly';

/** Derive an hourly wage from an employee's salary. Monthly uses the Thai
 *  convention: ÷ workingDaysPerMonth ÷ standardDayHours. */
export function hourlyWage(args: {
  salaryType: SalaryType;
  baseSalary: Decimal | string | number;
  standardDayHours: number;
  workingDaysPerMonth: number;
}): Decimal {
  const base = new Decimal(args.baseSalary);
  switch (args.salaryType) {
    case 'Hourly':
      return base;
    case 'Daily':
      return base.div(args.standardDayHours);
    case 'Monthly':
      return base.div(args.workingDaysPerMonth).div(args.standardDayHours);
  }
}

/** OT pay for one entry. PerHourAmount = hours × ratePerHour; Multiplier =
 *  hours × wage × multiplier. Missing rate value → 0. Rounded to 2 dp. */
export function computeOtAmount(args: {
  minutes: number;
  rateType: OtRateType;
  ratePerHour?: Decimal | string | number | null;
  multiplier?: Decimal | string | number | null;
  wage: Decimal;
}): Decimal {
  const hours = new Decimal(args.minutes).div(60);
  if (args.rateType === 'PerHourAmount') {
    return hours.times(new Decimal(args.ratePerHour ?? 0)).toDecimalPlaces(2);
  }
  return hours
    .times(args.wage)
    .times(new Decimal(args.multiplier ?? 0))
    .toDecimalPlaces(2);
}

/** Minutes a clock-out ran past the scheduled end ("HH:MM" both), clamped ≥0. */
export function overtimeMinutes(scheduledEnd: string, clockOut: string): number {
  const diff = minutesOf(clockOut) - minutesOf(scheduledEnd);
  return diff > 0 ? diff : 0;
}
