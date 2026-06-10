import { describe, expect, it } from 'vitest';
import { payrollPeriodFor, periodEarnings } from './period-earnings';

describe('payrollPeriodFor', () => {
  // cutoffDay=25: period containing 2026-06-10 is [2026-05-26 .. 2026-06-25]
  it('date before/equal cutoff → prev-month 26th to this-month 25th', () => {
    expect(payrollPeriodFor('2026-06-10', 25)).toEqual({ start: '2026-05-26', end: '2026-06-25' });
    expect(payrollPeriodFor('2026-06-25', 25)).toEqual({ start: '2026-05-26', end: '2026-06-25' });
  });
  it('date after cutoff → this-month 26th to next-month 25th', () => {
    expect(payrollPeriodFor('2026-06-26', 25)).toEqual({ start: '2026-06-26', end: '2026-07-25' });
  });
  it('handles January wrap', () => {
    expect(payrollPeriodFor('2026-01-10', 25)).toEqual({ start: '2025-12-26', end: '2026-01-25' });
  });
});

describe('periodEarnings', () => {
  const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
  it('Daily: distinct worked dates × rate', () => {
    const rows = [
      {
        date: day('2026-06-01'),
        clockInAt: new Date('2026-06-01T01:00:00Z'),
        clockOutAt: new Date('2026-06-01T10:00:00Z'),
      },
      { date: day('2026-06-02'), clockInAt: new Date('2026-06-02T01:00:00Z'), clockOutAt: null },
      { date: day('2026-06-02'), clockInAt: new Date('2026-06-02T03:00:00Z'), clockOutAt: null }, // same date, counted once
    ];
    expect(periodEarnings('Daily', 400, rows)).toBe(800);
  });
  it('Hourly: Σ clocked minutes / 60 × rate; rows without clockOut contribute 0', () => {
    const rows = [
      {
        date: day('2026-06-01'),
        clockInAt: new Date('2026-06-01T02:00:00Z'),
        clockOutAt: new Date('2026-06-01T06:30:00Z'),
      }, // 4.5h
      { date: day('2026-06-02'), clockInAt: new Date('2026-06-02T02:00:00Z'), clockOutAt: null },
    ];
    expect(periodEarnings('Hourly', 100, rows)).toBe(450);
  });
});
