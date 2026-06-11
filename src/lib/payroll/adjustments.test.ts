import { describe, expect, it } from 'vitest';
import { adjustmentAppliesToMonth } from './adjustments';

describe('adjustmentAppliesToMonth', () => {
  it('one-time (start == end) applies only to that month', () => {
    const a = { startMonth: '2026-06', endMonth: '2026-06' };
    expect(adjustmentAppliesToMonth(a, '2026-05')).toBe(false);
    expect(adjustmentAppliesToMonth(a, '2026-06')).toBe(true);
    expect(adjustmentAppliesToMonth(a, '2026-07')).toBe(false);
  });

  it('open-ended monthly (endMonth null) applies from start onward', () => {
    const a = { startMonth: '2026-06', endMonth: null };
    expect(adjustmentAppliesToMonth(a, '2026-05')).toBe(false);
    expect(adjustmentAppliesToMonth(a, '2026-06')).toBe(true);
    expect(adjustmentAppliesToMonth(a, '2027-01')).toBe(true);
  });

  it('date-range applies inclusively on both bounds', () => {
    const a = { startMonth: '2026-06', endMonth: '2026-08' };
    expect(adjustmentAppliesToMonth(a, '2026-05')).toBe(false);
    expect(adjustmentAppliesToMonth(a, '2026-06')).toBe(true);
    expect(adjustmentAppliesToMonth(a, '2026-07')).toBe(true);
    expect(adjustmentAppliesToMonth(a, '2026-08')).toBe(true);
    expect(adjustmentAppliesToMonth(a, '2026-09')).toBe(false);
  });

  it('lexicographic compare crosses year boundaries correctly', () => {
    const a = { startMonth: '2025-11', endMonth: '2026-02' };
    expect(adjustmentAppliesToMonth(a, '2025-12')).toBe(true);
    expect(adjustmentAppliesToMonth(a, '2026-01')).toBe(true);
    expect(adjustmentAppliesToMonth(a, '2026-03')).toBe(false);
  });
});
