import { describe, expect, it } from 'vitest';
import { beYear, buildDayGrid, clampRange, isDisabled, parseISO, shiftMonth0 } from './be-calendar';

describe('be-calendar', () => {
  it('beYear adds 543', () => {
    expect(beYear(2026)).toBe(2569);
  });

  it('parseISO parses / rejects', () => {
    expect(parseISO('2026-07-12')).toEqual({ year: 2026, month0: 6, day: 12 });
    expect(parseISO('nope')).toBeNull();
    expect(parseISO('2026-13-01')).toBeNull();
  });

  it('shiftMonth0 wraps year at boundaries', () => {
    expect(shiftMonth0(2026, 11, 1)).toEqual({ year: 2027, month0: 0 }); // Dec -> Jan
    expect(shiftMonth0(2026, 0, -1)).toEqual({ year: 2025, month0: 11 }); // Jan -> Dec
    expect(shiftMonth0(2026, 6, 0)).toEqual({ year: 2026, month0: 6 });
  });

  it('clampRange swaps when end < start', () => {
    expect(clampRange('2026-07-10', '2026-07-01')).toEqual({
      from: '2026-07-01',
      to: '2026-07-10',
    });
    expect(clampRange('2026-07-01', '2026-07-10')).toEqual({
      from: '2026-07-01',
      to: '2026-07-10',
    });
  });

  it('isDisabled respects min/max (inclusive)', () => {
    expect(isDisabled('2026-07-12', '2026-07-12', undefined)).toBe(false); // == min ok
    expect(isDisabled('2026-07-11', '2026-07-12', undefined)).toBe(true);
    expect(isDisabled('2026-07-13', undefined, '2026-07-12')).toBe(true);
    expect(isDisabled('2026-07-12', undefined, undefined)).toBe(false);
  });

  it('buildDayGrid: 42 cells, marks today + disabled + inMonth', () => {
    const grid = buildDayGrid(2026, 6, {
      today: '2026-07-12',
      min: '2026-07-05',
      max: '2026-07-20',
    });
    expect(grid).toHaveLength(42);
    const jul12 = grid.find((c) => c.iso === '2026-07-12');
    expect(jul12).toMatchObject({ day: 12, inMonth: true, today: true, disabled: false });
    const jul01 = grid.find((c) => c.iso === '2026-07-01');
    expect(jul01).toMatchObject({ inMonth: true, disabled: true }); // before min
    const jun28 = grid.find((c) => c.iso === '2026-06-28'); // leading pad
    expect(jun28?.inMonth).toBe(false);
  });
});
