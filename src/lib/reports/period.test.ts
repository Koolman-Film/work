import { describe, expect, it } from 'vitest';
import { adjacentMonths, resolveReportPeriod } from './period';

describe('resolveReportPeriod', () => {
  const today = '2026-06-10';
  it('defaults to the current Bangkok calendar month', () => {
    expect(resolveReportPeriod({}, today)).toEqual({
      from: '2026-06-01',
      to: '2026-06-30',
      month: '2026-06',
    });
  });
  it('m=YYYY-MM selects that month', () => {
    expect(resolveReportPeriod({ m: '2026-02' }, today)).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
      month: '2026-02',
    });
  });
  it('explicit from/to overrides month (custom range)', () => {
    expect(resolveReportPeriod({ from: '2026-05-15', to: '2026-06-14' }, today)).toEqual({
      from: '2026-05-15',
      to: '2026-06-14',
      month: null,
    });
  });
  it('garbage input falls back to current month', () => {
    expect(resolveReportPeriod({ from: 'x', to: 'y', m: 'zzz' }, today).month).toBe('2026-06');
  });
  it('inverted range falls back to current month', () => {
    expect(resolveReportPeriod({ from: '2026-06-10', to: '2026-06-01' }, today).month).toBe(
      '2026-06',
    );
  });
  it('m=2026-13 (invalid month) falls back to current month', () => {
    expect(resolveReportPeriod({ m: '2026-13' }, today).month).toBe('2026-06');
  });
  it('from=2026-02-30 (impossible date) falls back to current month', () => {
    expect(resolveReportPeriod({ from: '2026-02-30', to: '2026-03-05' }, today).month).toBe(
      '2026-06',
    );
  });
  it('leap year m=2024-02 gives to 2024-02-29', () => {
    expect(resolveReportPeriod({ m: '2024-02' }, today)).toEqual({
      from: '2024-02-01',
      to: '2024-02-29',
      month: '2024-02',
    });
  });
  it('m=2026-07 gives to 2026-07-31', () => {
    expect(resolveReportPeriod({ m: '2026-07' }, today)).toEqual({
      from: '2026-07-01',
      to: '2026-07-31',
      month: '2026-07',
    });
  });
});

describe('resolveReportPeriod — cutoff alignment (C8)', () => {
  const today = '2026-06-10';
  it('month mode aligns to the payroll cutoff window when cutoffDay is given', () => {
    expect(resolveReportPeriod({ m: '2026-06' }, today, 26)).toEqual({
      from: '2026-05-27',
      to: '2026-06-26',
      month: '2026-06',
    });
  });
  it('default month also aligns to the cutoff window', () => {
    expect(resolveReportPeriod({}, today, 26)).toEqual({
      from: '2026-05-27',
      to: '2026-06-26',
      month: '2026-06',
    });
  });
  it('custom from/to ignores the cutoff (explicit range wins)', () => {
    expect(resolveReportPeriod({ from: '2026-06-01', to: '2026-06-15' }, today, 26)).toEqual({
      from: '2026-06-01',
      to: '2026-06-15',
      month: null,
    });
  });
  it('falls back to calendar month for an out-of-range cutoff', () => {
    expect(resolveReportPeriod({ m: '2026-06' }, today, 31)).toEqual({
      from: '2026-06-01',
      to: '2026-06-30',
      month: '2026-06',
    });
  });
});

describe('adjacentMonths', () => {
  it('returns prev/next within a year', () => {
    expect(adjacentMonths('2026-06')).toEqual({ prev: '2026-05', next: '2026-07' });
  });
  it('January wraps prev to December of previous year', () => {
    expect(adjacentMonths('2026-01')).toEqual({ prev: '2025-12', next: '2026-02' });
  });
  it('December wraps next to January of next year', () => {
    expect(adjacentMonths('2026-12')).toEqual({ prev: '2026-11', next: '2027-01' });
  });
});
