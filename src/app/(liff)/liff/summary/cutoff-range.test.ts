import { describe, expect, it } from 'vitest';
import { isWholeCalendarMonth } from './cutoff-range';

describe('isWholeCalendarMonth', () => {
  it('a plain calendar month (no payroll cutoff configured)', () => {
    expect(isWholeCalendarMonth('2026-08', '2026-08-01', '2026-08-31')).toBe(true);
  });

  it('February in a leap year', () => {
    expect(isWholeCalendarMonth('2024-02', '2024-02-01', '2024-02-29')).toBe(true);
  });

  it('February in a non-leap year', () => {
    expect(isWholeCalendarMonth('2026-02', '2026-02-01', '2026-02-28')).toBe(true);
  });

  it('a payroll cutoff window is NOT a calendar month', () => {
    // cutoffDay 26 → "2026-08" runs 27 Jul – 26 Aug.
    expect(isWholeCalendarMonth('2026-08', '2026-07-27', '2026-08-26')).toBe(false);
  });

  it('cutoffDay 1 — still not a calendar month even though `to` looks like one', () => {
    expect(isWholeCalendarMonth('2026-08', '2026-07-02', '2026-08-01')).toBe(false);
  });

  it('right start, short end', () => {
    expect(isWholeCalendarMonth('2026-08', '2026-08-01', '2026-08-30')).toBe(false);
  });
});
