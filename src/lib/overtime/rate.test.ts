import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { computeOtAmount, hourlyWage, overtimeMinutes } from './rate';

describe('hourlyWage', () => {
  it('Hourly → baseSalary as-is', () => {
    expect(
      hourlyWage({
        salaryType: 'Hourly',
        baseSalary: 60,
        standardDayHours: 7,
        workingDaysPerMonth: 30,
      }).toNumber(),
    ).toBe(60);
  });

  it('Daily → base / standardDayHours', () => {
    expect(
      hourlyWage({
        salaryType: 'Daily',
        baseSalary: 700,
        standardDayHours: 7,
        workingDaysPerMonth: 30,
      }).toNumber(),
    ).toBe(100);
  });

  it('Monthly → base / (workingDaysPerMonth × standardDayHours)', () => {
    expect(
      hourlyWage({
        salaryType: 'Monthly',
        baseSalary: 21000,
        standardDayHours: 7,
        workingDaysPerMonth: 30,
      }).toNumber(),
    ).toBe(100); // 21000 / 30 / 7
  });
});

describe('computeOtAmount', () => {
  const wage = new Decimal(100);

  it('PerHourAmount → hours × ratePerHour', () => {
    expect(
      computeOtAmount({
        minutes: 90,
        rateType: 'PerHourAmount',
        ratePerHour: 120,
        wage,
      }).toNumber(),
    ).toBe(180); // 1.5h × 120
  });

  it('Multiplier → hours × wage × multiplier', () => {
    expect(
      computeOtAmount({ minutes: 120, rateType: 'Multiplier', multiplier: 1.5, wage }).toNumber(),
    ).toBe(300); // 2h × 100 × 1.5
  });

  it('missing rate value → 0', () => {
    expect(computeOtAmount({ minutes: 60, rateType: 'PerHourAmount', wage }).toNumber()).toBe(0);
  });
});

describe('overtimeMinutes', () => {
  it('positive difference past scheduled end', () => {
    expect(overtimeMinutes('17:00', '18:30')).toBe(90);
  });

  it('clamps to 0 when not past end', () => {
    expect(overtimeMinutes('17:00', '16:45')).toBe(0);
    expect(overtimeMinutes('17:00', '17:00')).toBe(0);
  });
});
