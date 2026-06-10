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
