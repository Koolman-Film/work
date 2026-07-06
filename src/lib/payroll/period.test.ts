import { describe, expect, it } from 'vitest';
import { payrollMonthWindow, payrollMonthWindowYmd, payrollPeriodLabel } from './period';

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

describe('payrollPeriodLabel', () => {
  it('renders the cutoff window as a Thai Buddhist-era date range (matches the report period)', () => {
    // Same window resolveReportPeriod produces for { m: '2026-06' }, cutoff 26.
    expect(payrollPeriodLabel('2026-06', 26)).toBe('27 พ.ค. 2569 – 26 มิ.ย. 2569');
  });

  it('rolls the year at the January boundary', () => {
    expect(payrollPeriodLabel('2026-01', 26)).toBe('27 ธ.ค. 2568 – 26 ม.ค. 2569');
  });

  it('rejects an out-of-range cutoff day (callers must range-guard, like resolveReportPeriod)', () => {
    expect(() => payrollPeriodLabel('2026-06', 31)).toThrow(/cutoffDay must be 1–28/);
    expect(() => payrollPeriodLabel('2026-06', 0)).toThrow(/cutoffDay must be 1–28/);
  });
});
