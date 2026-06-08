import { describe, expect, it } from 'vitest';
import { birthdayTargets } from './birthday-targets';

// The cron fires at 09:00 Bangkok = 02:00 UTC; pick instants around that.
describe('birthdayTargets', () => {
  it('returns today + tomorrow month/day in Bangkok', () => {
    // 2026-06-08 02:00 UTC → Bangkok 09:00 Jun 8
    expect(birthdayTargets(new Date('2026-06-08T02:00:00Z'))).toEqual({
      todMonth: 6,
      todDay: 8,
      tomMonth: 6,
      tomDay: 9,
    });
  });

  it('rolls over month end (Jan 31 → Feb 1)', () => {
    expect(birthdayTargets(new Date('2026-01-31T02:00:00Z'))).toEqual({
      todMonth: 1,
      todDay: 31,
      tomMonth: 2,
      tomDay: 1,
    });
  });

  it('rolls over year end (Dec 31 → Jan 1)', () => {
    expect(birthdayTargets(new Date('2026-12-31T02:00:00Z'))).toEqual({
      todMonth: 12,
      todDay: 31,
      tomMonth: 1,
      tomDay: 1,
    });
  });

  it('uses the Bangkok calendar day, not UTC (late-UTC instant)', () => {
    // 2026-06-08 20:00 UTC → Bangkok 03:00 Jun 9
    expect(birthdayTargets(new Date('2026-06-08T20:00:00Z'))).toEqual({
      todMonth: 6,
      todDay: 9,
      tomMonth: 6,
      tomDay: 10,
    });
  });
});
