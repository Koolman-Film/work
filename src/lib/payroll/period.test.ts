import { describe, expect, it } from 'vitest';
import { payrollMonthWindow, payrollMonthWindowYmd } from './period';

describe('payrollMonthWindow', () => {
  it('cutoff 26 → 27th of prev month through 26th of this month (PDF C8)', () => {
    expect(payrollMonthWindowYmd('2026-06', 26)).toEqual({ from: '2026-05-27', to: '2026-06-26' });
  });

  it('rolls the year at the January boundary', () => {
    expect(payrollMonthWindowYmd('2026-01', 26)).toEqual({ from: '2025-12-27', to: '2026-01-26' });
  });

  it('handles a February end month (short month) without overflow', () => {
    // prev month = January, cutoff+1 = 27 → Jan 27; both valid.
    expect(payrollMonthWindowYmd('2026-02', 26)).toEqual({ from: '2026-01-27', to: '2026-02-26' });
  });

  it('returns UTC-midnight Date bounds with an inclusive end', () => {
    const { start, end } = payrollMonthWindow('2026-06', 26);
    expect(start.toISOString()).toBe('2026-05-27T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-06-26T00:00:00.000Z');
  });

  it('rejects an out-of-range cutoff day', () => {
    expect(() => payrollMonthWindow('2026-06', 31)).toThrow(/cutoffDay must be 1–28/);
    expect(() => payrollMonthWindow('2026-06', 0)).toThrow(/cutoffDay must be 1–28/);
  });

  it('rejects an invalid month', () => {
    expect(() => payrollMonthWindow('2026-13', 26)).toThrow(/invalid month/);
  });
});
