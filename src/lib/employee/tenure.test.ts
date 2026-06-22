import { describe, expect, it } from 'vitest';
import { formatTenureThai, tenureBreakdown } from './tenure';

describe('tenureBreakdown', () => {
  it('computes a whole-year span', () => {
    expect(tenureBreakdown('2020-06-22', '2026-06-22')).toEqual({ years: 6, months: 0, days: 0 });
  });

  it('computes years + months + days', () => {
    expect(tenureBreakdown('2026-02-17', '2026-06-22')).toEqual({ years: 0, months: 4, days: 5 });
  });

  it('borrows across uneven month lengths (Jan 31 → Mar 1)', () => {
    // Jan 31 to Mar 1: 1 month + 1 day (Feb is "consumed" as the whole month).
    expect(tenureBreakdown('2026-01-31', '2026-03-01')).toEqual({ years: 0, months: 1, days: 1 });
  });

  it('returns all-zero when start === today (hired today)', () => {
    expect(tenureBreakdown('2026-06-22', '2026-06-22')).toEqual({ years: 0, months: 0, days: 0 });
  });

  it('returns null for a future start date', () => {
    expect(tenureBreakdown('2026-12-01', '2026-06-22')).toBeNull();
  });

  it('returns null for a malformed date', () => {
    expect(tenureBreakdown('', '2026-06-22')).toBeNull();
    expect(tenureBreakdown('2026-13-99', '2026-06-22')).toBeNull();
  });
});

describe('formatTenureThai', () => {
  it('always renders all three units', () => {
    expect(formatTenureThai({ years: 0, months: 4, days: 5 })).toBe('0 ปี 4 เดือน 5 วัน');
    expect(formatTenureThai({ years: 6, months: 0, days: 0 })).toBe('6 ปี 0 เดือน 0 วัน');
  });
});
