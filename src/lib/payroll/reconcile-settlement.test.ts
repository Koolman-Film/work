import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import type { CalcBreakdown } from './calc';
import { EMPTY_SETTLEMENT } from './penalty-settlement';
import {
  actualDaysFromAttendance,
  hasAnyOverSettlement,
  isOverSettled,
  kindsToShow,
} from './reconcile-settlement';

const ZERO = new Decimal(0);

function attendance(
  overrides: Partial<CalcBreakdown['attendance']> = {},
): CalcBreakdown['attendance'] {
  return {
    absent: { count: 0, derivedDays: 0, perDay: ZERO, money: ZERO },
    lateTier1: { mode: 'flat', count: 0, perUnit: ZERO, money: ZERO },
    lateSevere: { days: 0, perDay: ZERO, money: ZERO },
    earlyLeave: { count: 0, perUnit: ZERO, money: ZERO },
    settledDays: { ...EMPTY_SETTLEMENT },
    ...overrides,
  };
}

describe('actualDaysFromAttendance', () => {
  it('reads Absent straight off the absent count', () => {
    const days = actualDaysFromAttendance(
      attendance({ absent: { count: 2, derivedDays: 0, perDay: ZERO, money: ZERO } }),
    );
    expect(days.Absent).toBe(2);
  });

  it('counts DERIVED absent days too — they are settleable like any other', () => {
    // absent.count already includes derivedDays (calc.ts), so a day the system
    // inferred can be settled with leave exactly as a keyed one can. It stays a
    // whole number, so the settled-vs-actual guard is unaffected structurally.
    const days = actualDaysFromAttendance(
      attendance({ absent: { count: 3, derivedDays: 3, perDay: ZERO, money: ZERO } }),
    );
    expect(days.Absent).toBe(3);
  });

  it('reads LateThreeStrike from lateTier1.days only in threeStrike mode', () => {
    const threeStrike = actualDaysFromAttendance(
      attendance({
        lateTier1: {
          mode: 'threeStrike',
          count: 6,
          threeStrikeCount: 3,
          days: 2,
          perUnit: ZERO,
          money: ZERO,
        },
      }),
    );
    expect(threeStrike.LateThreeStrike).toBe(2);
  });

  it('reads LateThreeStrike as 0 in flat mode even if days happens to be set', () => {
    // Defensive: flat mode never sets `days` in practice, but the type only
    // makes it optional, not absent-when-flat — a stale value must not leak.
    const flat = actualDaysFromAttendance(
      attendance({ lateTier1: { mode: 'flat', count: 4, days: 1, perUnit: ZERO, money: ZERO } }),
    );
    expect(flat.LateThreeStrike).toBe(0);
  });

  it('reads SevereLate straight off lateSevere.days', () => {
    const days = actualDaysFromAttendance(
      attendance({ lateSevere: { days: 1, perDay: ZERO, money: ZERO } }),
    );
    expect(days.SevereLate).toBe(1);
  });
});

describe('kindsToShow', () => {
  it('shows a kind with an actual penalty and no settlement', () => {
    const actual = { ...EMPTY_SETTLEMENT, Absent: 1 };
    expect(kindsToShow(actual, EMPTY_SETTLEMENT)).toEqual(['Absent']);
  });

  it('shows a kind with a lingering settlement even when the actual penalty is now 0', () => {
    const settled = { ...EMPTY_SETTLEMENT, SevereLate: 1 };
    expect(kindsToShow(EMPTY_SETTLEMENT, settled)).toEqual(['SevereLate']);
  });

  it('shows nothing when a kind has neither an actual penalty nor a settlement', () => {
    expect(kindsToShow(EMPTY_SETTLEMENT, EMPTY_SETTLEMENT)).toEqual([]);
  });

  it('preserves kind order (Absent, LateThreeStrike, SevereLate)', () => {
    const actual = { Absent: 1, LateThreeStrike: 1, SevereLate: 1 };
    expect(kindsToShow(actual, EMPTY_SETTLEMENT)).toEqual([
      'Absent',
      'LateThreeStrike',
      'SevereLate',
    ]);
  });
});

describe('isOverSettled', () => {
  it('is true when settled days exceed the actual penalty', () => {
    expect(isOverSettled(0, 1)).toBe(true);
    expect(isOverSettled(1, 2)).toBe(true);
  });

  it('is false when settled days are within the actual penalty', () => {
    expect(isOverSettled(2, 1)).toBe(false);
    expect(isOverSettled(1, 1)).toBe(false);
    expect(isOverSettled(0, 0)).toBe(false);
  });
});

describe('hasAnyOverSettlement', () => {
  it('is true when any single kind is over-settled', () => {
    const actual = { Absent: 0, LateThreeStrike: 1, SevereLate: 1 };
    const settled = { Absent: 1, LateThreeStrike: 1, SevereLate: 0 };
    expect(hasAnyOverSettlement(actual, settled)).toBe(true);
  });

  it('is false when every kind is within its actual penalty', () => {
    const actual = { Absent: 2, LateThreeStrike: 1, SevereLate: 0 };
    const settled = { Absent: 1, LateThreeStrike: 1, SevereLate: 0 };
    expect(hasAnyOverSettlement(actual, settled)).toBe(false);
  });
});
