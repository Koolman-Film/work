import { describe, expect, it } from 'vitest';
import {
  beYear,
  buildDayGrid,
  clampRange,
  isDisabled,
  parseISO,
  parseTypedDate,
  shiftMonth0,
} from './be-calendar';

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

describe('parseTypedDate', () => {
  it('reads a Thai day/month/BE-year date', () => {
    expect(parseTypedDate('27/04/2537', 'dmy')).toBe('1994-04-27');
    expect(parseTypedDate('4/11/2569', 'dmy')).toBe('2026-11-04');
  });

  it('accepts other separators, bare digits and Thai digits', () => {
    expect(parseTypedDate('27-4-2537', 'dmy')).toBe('1994-04-27');
    expect(parseTypedDate(' 27.04.2537 ', 'dmy')).toBe('1994-04-27');
    expect(parseTypedDate('27042537', 'dmy')).toBe('1994-04-27');
    expect(parseTypedDate('๒๗/๐๔/๒๕๓๗', 'dmy')).toBe('1994-04-27');
  });

  it('keeps a CE year as typed', () => {
    expect(parseTypedDate('27/04/1994', 'dmy')).toBe('1994-04-27');
  });

  it('follows the locale order', () => {
    expect(parseTypedDate('04/27/1994', 'mdy')).toBe('1994-04-27');
    expect(parseTypedDate('1994/04/27', 'ymd')).toBe('1994-04-27');
    expect(parseTypedDate('19940427', 'ymd')).toBe('1994-04-27');
  });

  it('refuses what is not a real date', () => {
    expect(parseTypedDate('', 'dmy')).toBeNull();
    expect(parseTypedDate('31/02/2569', 'dmy')).toBeNull();
    expect(parseTypedDate('29/02/2568', 'dmy')).toBeNull(); // 2025: not a leap year
    expect(parseTypedDate('29/02/2567', 'dmy')).toBe('2024-02-29');
    expect(parseTypedDate('13/13/2569', 'dmy')).toBeNull();
    expect(parseTypedDate('27/04/37', 'dmy')).toBeNull(); // two-digit year: never guessed
    expect(parseTypedDate('27/04', 'dmy')).toBeNull();
    expect(parseTypedDate('hello', 'dmy')).toBeNull();
  });
});
