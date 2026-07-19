import { describe, expect, it } from 'vitest';
import { EMPTY_SETTLEMENT, moneyDaysFor } from './penalty-settlement';

describe('moneyDaysFor', () => {
  it('subtracts the settled days from the actual days', () => {
    expect(moneyDaysFor(3, 1)).toBe(2);
  });

  it('returns 0 when the whole penalty is settled with leave', () => {
    expect(moneyDaysFor(1, 1)).toBe(0);
  });

  it('never returns a negative day count when the penalty disappeared', () => {
    // An admin settles one absent day with leave, then voids the attendance
    // row. Without the clamp the caller multiplies -1 by the day rate and the
    // "penalty" pays the employee an extra day's wages.
    expect(moneyDaysFor(0, 1)).toBe(0);
    expect(moneyDaysFor(1, 3)).toBe(0);
  });

  it('is a no-op when nothing was settled', () => {
    expect(moneyDaysFor(2, 0)).toBe(2);
    expect(moneyDaysFor(0, 0)).toBe(0);
  });
});

describe('EMPTY_SETTLEMENT', () => {
  it('is zero for every penalty kind', () => {
    expect(EMPTY_SETTLEMENT).toEqual({ Absent: 0, LateThreeStrike: 0, SevereLate: 0 });
  });
});
