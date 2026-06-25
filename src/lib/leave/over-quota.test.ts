import { describe, expect, it } from 'vitest';
import {
  deductionForOverQuota,
  overQuotaMinutesFor,
  perMinuteRate,
  replayOverQuota,
} from './over-quota';

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

describe('replayOverQuota', () => {
  const ent = (granted: number | null, adjust = 0) => ({
    grantedMinutes: granted,
    carryoverMinutes: 0,
    adjustmentMinutes: adjust,
  });

  it('charges over-quota in order — earlier requests consume the quota first', () => {
    // granted 480 (1 day). r1 480 fits; r2 60 is fully over.
    const r = replayOverQuota(
      ent(480),
      [
        { id: 'a', chargedMinutes: 480 },
        { id: 'b', chargedMinutes: 60 },
      ],
      1,
    );
    expect(r).toEqual([
      { id: 'a', overQuotaMinutes: 0, deductAmount: null },
      { id: 'b', overQuotaMinutes: 60, deductAmount: 60 },
    ]);
  });

  it('a single request that straddles the quota charges only the excess', () => {
    const r = replayOverQuota(ent(480), [{ id: 'a', chargedMinutes: 540 }], 1);
    expect(r[0]).toEqual({ id: 'a', overQuotaMinutes: 60, deductAmount: 60 });
  });

  it('a negative effective entitlement makes every request fully over-quota', () => {
    // granted 1440 + adjustment −3600 → base −2160. Mirrors the prod ติ๋ว case.
    const r = replayOverQuota(
      ent(1440, -3600),
      [
        { id: 'a', chargedMinutes: 480 },
        { id: 'b', chargedMinutes: 180 },
      ],
      1,
    );
    expect(r[0]?.overQuotaMinutes).toBe(480);
    expect(r[1]?.overQuotaMinutes).toBe(180);
  });

  it('unlimited entitlement (granted null) → never over quota', () => {
    const r = replayOverQuota(ent(null), [{ id: 'a', chargedMinutes: 9999 }], 1);
    expect(r[0]).toEqual({ id: 'a', overQuotaMinutes: 0, deductAmount: null });
  });

  it('applies the per-minute rate to the deduction', () => {
    const r = replayOverQuota(ent(0), [{ id: 'a', chargedMinutes: 120 }], 1.5);
    expect(r[0]).toEqual({ id: 'a', overQuotaMinutes: 120, deductAmount: 180 });
  });
});
