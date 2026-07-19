import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DAYS_PER_MONTH, dailyRateFor } from './day-rate';

const FALLBACK = '500';

describe('DEFAULT_DAYS_PER_MONTH', () => {
  it('is 30 — the Thai convention this codebase already assumed in comments', () => {
    expect(DEFAULT_DAYS_PER_MONTH).toBe(30);
  });
});

describe('dailyRateFor — Monthly, no config divisor passed', () => {
  it('divides the monthly salary by the 30-day default', () => {
    expect(dailyRateFor({ salaryType: 'Monthly', baseSalary: '30000' }, FALLBACK).toString()).toBe(
      '1000',
    );
  });

  it('keeps precision on a non-round result', () => {
    // ฿10,000/30 = 333.333… — this is the employee the flat ฿500 over-charged by 50%
    const r = dailyRateFor({ salaryType: 'Monthly', baseSalary: '10000' }, FALLBACK);
    expect(r.toDecimalPlaces(2).toString()).toBe('333.33');
  });

  it('falls back when the salary is zero rather than deducting nothing', () => {
    expect(dailyRateFor({ salaryType: 'Monthly', baseSalary: '0' }, FALLBACK).toString()).toBe(
      '500',
    );
  });
});

describe('dailyRateFor — Monthly, PayrollConfig.workingDaysPerMonth threaded through', () => {
  it('uses the configured divisor instead of 30', () => {
    // ฿20,000 / 26 = 769.230... — this is the same divisor leave over-quota
    // (over-quota.ts) and OT (overtime/rate.ts) already use; an absence must
    // price identically to a leave-day on the same payslip.
    const r = dailyRateFor({ salaryType: 'Monthly', baseSalary: '20000' }, FALLBACK, 26);
    expect(r.toDecimalPlaces(2).toString()).toBe('769.23');
  });

  it('does not affect Daily employees — baseSalary IS the day rate regardless of the divisor', () => {
    expect(dailyRateFor({ salaryType: 'Daily', baseSalary: '450' }, FALLBACK, 26).toString()).toBe(
      '450',
    );
  });

  it('does not affect the Hourly fallback', () => {
    expect(dailyRateFor({ salaryType: 'Hourly', baseSalary: '100' }, FALLBACK, 26).toString()).toBe(
      '500',
    );
  });

  it('falls back to 30 when the divisor is zero', () => {
    const r = dailyRateFor({ salaryType: 'Monthly', baseSalary: '30000' }, FALLBACK, 0);
    expect(r.toString()).toBe('1000'); // 30000/30, not Infinity or a throw
  });

  it('falls back to 30 when the divisor is negative', () => {
    const r = dailyRateFor({ salaryType: 'Monthly', baseSalary: '30000' }, FALLBACK, -5);
    expect(r.toString()).toBe('1000'); // not a flipped-sign result
  });

  it('falls back to 30 when the divisor is null', () => {
    const r = dailyRateFor({ salaryType: 'Monthly', baseSalary: '30000' }, FALLBACK, null);
    expect(r.toString()).toBe('1000');
  });

  it('falls back to 30 when the divisor is NaN', () => {
    const r = dailyRateFor({ salaryType: 'Monthly', baseSalary: '30000' }, FALLBACK, Number.NaN);
    expect(r.toString()).toBe('1000');
  });

  it('falls back to 30 when the divisor is omitted (undefined)', () => {
    const r = dailyRateFor({ salaryType: 'Monthly', baseSalary: '30000' }, FALLBACK, undefined);
    expect(r.toString()).toBe('1000');
  });
});

describe('dailyRateFor — Daily', () => {
  it('uses baseSalary as-is: it IS the day rate', () => {
    // Dividing by 30 here would yield ฿15 — the mistake this case exists to prevent
    expect(dailyRateFor({ salaryType: 'Daily', baseSalary: '450' }, FALLBACK).toString()).toBe(
      '450',
    );
  });
});

describe('dailyRateFor — Hourly and bad data', () => {
  it('falls back for Hourly — no standard hours-per-day exists in the system', () => {
    expect(dailyRateFor({ salaryType: 'Hourly', baseSalary: '100' }, FALLBACK).toString()).toBe(
      '500',
    );
  });

  it('uses whatever fallback the caller passes, not a hardcoded 500', () => {
    expect(dailyRateFor({ salaryType: 'Hourly', baseSalary: '100' }, '250').toString()).toBe('250');
  });

  it('accepts a Decimal for either argument', () => {
    expect(
      dailyRateFor(
        { salaryType: 'Monthly', baseSalary: new Decimal('30000') },
        new Decimal('500'),
      ).toString(),
    ).toBe('1000');
  });
});
