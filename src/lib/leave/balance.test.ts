import { describe, expect, it } from 'vitest';
import { remainingMinutes, resolveGrantedMinutes } from './balance';

describe('remainingMinutes', () => {
  it('granted + carryover + adjustment − used', () => {
    expect(
      remainingMinutes(
        { grantedMinutes: 2520, carryoverMinutes: 420, adjustmentMinutes: -420 },
        840,
        0,
      ),
    ).toBe(1680); // 2520 + 420 − 420 − 840
  });

  it('can go negative (over-used)', () => {
    expect(
      remainingMinutes({ grantedMinutes: 420, carryoverMinutes: 0, adjustmentMinutes: 0 }, 840, 0),
    ).toBe(-420);
  });

  it('null granted (unlimited) → null', () => {
    expect(
      remainingMinutes({ grantedMinutes: null, carryoverMinutes: 0, adjustmentMinutes: 0 }, 999, 0),
    ).toBeNull();
  });
});

describe('remainingMinutes with penalty minutes', () => {
  const ent = { grantedMinutes: 2880, carryoverMinutes: 0, adjustmentMinutes: 0 }; // 6 days

  it('subtracts penalty minutes from the remaining balance', () => {
    expect(remainingMinutes(ent, 480, 480)).toBe(1920); // 6 − 1 used − 1 penalty = 4 days
  });

  it('is unchanged when no penalty applies', () => {
    expect(remainingMinutes(ent, 480, 0)).toBe(2400);
  });

  it('still reports unlimited quota as null regardless of penalties', () => {
    expect(
      remainingMinutes({ grantedMinutes: null, carryoverMinutes: 0, adjustmentMinutes: 0 }, 0, 480),
    ).toBeNull();
  });

  it('may go negative when entitlement is cut after a penalty was settled', () => {
    expect(remainingMinutes({ ...ent, grantedMinutes: 480 }, 480, 480)).toBe(-480);
  });
});

describe('resolveGrantedMinutes', () => {
  const STD = 420; // 7h day

  it('uses the entitlement grant when an entitlement row exists', () => {
    expect(resolveGrantedMinutes(6, { grantedMinutes: 2520 }, STD)).toBe(2520);
  });

  it('entitlement with null grant stays unlimited even if the type has a quota', () => {
    expect(resolveGrantedMinutes(6, { grantedMinutes: null }, STD)).toBeNull();
  });

  it('no entitlement → falls back to annualQuota × std', () => {
    expect(resolveGrantedMinutes(6, null, STD)).toBe(2520); // 6 × 420
  });

  it('no entitlement + null quota → unlimited', () => {
    expect(resolveGrantedMinutes(null, null, STD)).toBeNull();
  });
});
