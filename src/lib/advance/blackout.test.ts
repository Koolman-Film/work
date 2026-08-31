import { describe, expect, it } from 'vitest';
import { isInAdvanceBlackout } from './blackout';

describe('isInAdvanceBlackout', () => {
  it('0 days disables the feature entirely', () => {
    expect(isInAdvanceBlackout('2026-08-25', 25, 0)).toBe(false);
  });

  it('blocks the cutoff day itself', () => {
    expect(isInAdvanceBlackout('2026-08-25', 25, 3)).toBe(true);
  });

  it('blocks the N-1 days before the cutoff', () => {
    expect(isInAdvanceBlackout('2026-08-23', 25, 3)).toBe(true);
    expect(isInAdvanceBlackout('2026-08-24', 25, 3)).toBe(true);
  });

  it('does not block the day before the window opens', () => {
    expect(isInAdvanceBlackout('2026-08-22', 25, 3)).toBe(false);
  });

  it('does not block the day after the cutoff', () => {
    expect(isInAdvanceBlackout('2026-08-26', 25, 3)).toBe(false);
  });

  it('a window longer than the cutoff day does NOT wrap into the previous month', () => {
    // cutoffDay 3 with a 5-day window: days 1-3 are blocked, and 27-31 of the
    // PREVIOUS month are not. Those days belong to a different payroll period,
    // and silently blocking a week nobody configured is worse than a short
    // window.
    expect(isInAdvanceBlackout('2026-08-01', 3, 5)).toBe(true);
    expect(isInAdvanceBlackout('2026-08-03', 3, 5)).toBe(true);
    expect(isInAdvanceBlackout('2026-07-30', 3, 5)).toBe(false);
    expect(isInAdvanceBlackout('2026-07-31', 3, 5)).toBe(false);
  });

  it('a 1-day window blocks only the cutoff day', () => {
    expect(isInAdvanceBlackout('2026-08-25', 25, 1)).toBe(true);
    expect(isInAdvanceBlackout('2026-08-24', 25, 1)).toBe(false);
  });

  it('treats a negative or non-integer window as off rather than throwing', () => {
    expect(isInAdvanceBlackout('2026-08-25', 25, -3)).toBe(false);
    expect(isInAdvanceBlackout('2026-08-25', 25, 2.5)).toBe(false);
  });

  it('returns false for an unparseable date rather than blocking everyone', () => {
    // Fail OPEN: a bad date must not lock the whole company out of requesting.
    expect(isInAdvanceBlackout('not-a-date', 25, 3)).toBe(false);
  });
});
