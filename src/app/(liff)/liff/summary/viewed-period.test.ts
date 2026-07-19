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
});
