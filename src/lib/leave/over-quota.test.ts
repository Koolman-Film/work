import { describe, expect, it } from 'vitest';
import { deductionForOverQuota, overQuotaMinutesFor, perMinuteRate } from './over-quota';

describe('perMinuteRate', () => {
  // std day = 420 min (09:00–12:00 + 13:00–17:00), workingDaysPerMonth = 30
  it('Monthly: baseSalary / workingDays / stdDayMinutes', () => {
    expect(perMinuteRate('Monthly', 12600, 30, 420)).toBeCloseTo(1); // 12600/30/420
  });
  it('Daily: baseSalary / stdDayMinutes', () => {
    expect(perMinuteRate('Daily', 420, 30, 420)).toBeCloseTo(1);
  });
  it('Hourly: baseSalary / 60', () => {
    expect(perMinuteRate('Hourly', 60, 30, 420)).toBeCloseTo(1);
  });
});

describe('overQuotaMinutesFor', () => {
  it('null remaining (unlimited) → 0', () => {
    expect(overQuotaMinutesFor(420, null)).toBe(0);
  });
  it('within quota → 0', () => {
    expect(overQuotaMinutesFor(420, 840)).toBe(0);
  });
  it('partially over → only the excess', () => {
    expect(overQuotaMinutesFor(840, 420)).toBe(420);
  });
  it('negative remaining clamps to 0 — current charge is fully over, no retro-charge', () => {
    expect(overQuotaMinutesFor(420, -100)).toBe(420);
  });
});

describe('deductionForOverQuota', () => {
  it('rounds to 2dp', () => {
    expect(deductionForOverQuota(125, 1.2345)).toBe(154.31);
  });
  it('0 over-quota → 0', () => {
    expect(deductionForOverQuota(0, 99)).toBe(0);
  });
});
