import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { DAYS_PER_MONTH, dailyRateFor } from './day-rate';

const FALLBACK = '500';

describe('DAYS_PER_MONTH', () => {
  it('is 30 — the Thai convention this codebase already assumed in comments', () => {
    expect(DAYS_PER_MONTH).toBe(30);
  });
});

describe('dailyRateFor — Monthly', () => {
  it('divides the monthly salary by 30', () => {
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
