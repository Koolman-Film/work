import { describe, expect, it } from 'vitest';
import { remainingMinutes, resolveGrantedMinutes } from './balance';

describe('remainingMinutes', () => {
  it('granted + carryover + adjustment − used', () => {
    expect(
      remainingMinutes(
        { grantedMinutes: 2520, carryoverMinutes: 420, adjustmentMinutes: -420 },
        840,
      ),
    ).toBe(1680); // 2520 + 420 − 420 − 840
  });

  it('can go negative (over-used)', () => {
    expect(
      remainingMinutes({ grantedMinutes: 420, carryoverMinutes: 0, adjustmentMinutes: 0 }, 840),
    ).toBe(-420);
  });

  it('null granted (unlimited) → null', () => {
    expect(
      remainingMinutes({ grantedMinutes: null, carryoverMinutes: 0, adjustmentMinutes: 0 }, 999),
    ).toBeNull();
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
