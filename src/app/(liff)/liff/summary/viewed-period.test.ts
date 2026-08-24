import { describe, expect, it } from 'vitest';
import { viewedPeriod } from './viewed-period';

describe('viewedPeriod', () => {
  it('month mode: returns that month and its year', () => {
    expect(viewedPeriod({ from: '2026-06-01', month: '2026-06' })).toEqual({
      year: 2026,
      month: '2026-06',
    });
  });

  it('custom range mode: returns the range start month and its year', () => {
    expect(viewedPeriod({ from: '2025-11-20', month: null })).toEqual({
      year: 2025,
      month: '2025-11',
    });
  });

  it('custom range spanning two calendar years: anchors on the start year', () => {
    expect(viewedPeriod({ from: '2025-12-15', month: null })).toEqual({
      year: 2025,
      month: '2025-12',
    });
  });

  // Regression: once /liff/summary resolves its period against the payroll
  // cutoff, month mode's `from` is NOT the 1st of `period.month` any more —
  // month "2027-01" with cutoffDay 26 starts on 2026-12-27. Deriving the year
  // from `from` would report 2026 while the page renders "January 2027",
  // and the leave balance below it would be the WRONG YEAR's.
  it('month mode across a year boundary: year follows the month, not the range start', () => {
    expect(viewedPeriod({ from: '2026-12-27', month: '2027-01' })).toEqual({
      year: 2027,
      month: '2027-01',
    });
  });

  it('month mode with a cutoff window inside one year: unchanged', () => {
    expect(viewedPeriod({ from: '2026-07-27', month: '2026-08' })).toEqual({
      year: 2026,
      month: '2026-08',
    });
  });
});
