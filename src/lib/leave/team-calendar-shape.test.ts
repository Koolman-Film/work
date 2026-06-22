import { describe, expect, it } from 'vitest';
import {
  buildMonthGrid,
  currentMonthYM,
  formatThaiMonthLabel,
  indexAdvancesByDate,
  indexBirthdaysByDate,
  indexEntriesByDate,
  parseMonth,
  shiftMonth,
  type TeamCalendarAdvance,
  type TeamCalendarBirthday,
  type TeamCalendarEntry,
  ymd,
} from './team-calendar-shape';

const entry = (id: string, startDate: string, endDate: string): TeamCalendarEntry => ({
  leaveRequestId: id,
  employeeId: `emp-${id}`,
  employeeName: 'A A',
  shortLabel: 'A',
  leaveTypeName: 'ลาป่วย',
  status: 'Approved',
  startDate,
  endDate,
  isMine: false,
});

describe('ymd', () => {
  it('formats a UTC date as YYYY-MM-DD', () => {
    expect(ymd(new Date(Date.UTC(2026, 5, 3)))).toBe('2026-06-03');
    expect(ymd(new Date(Date.UTC(2026, 0, 1)))).toBe('2026-01-01');
  });
});

describe('parseMonth', () => {
  it('parses a valid YYYY-MM into UTC month bounds', () => {
    const p = parseMonth('2026-06');
    expect(p).not.toBeNull();
    expect(p?.year).toBe(2026);
    expect(p?.month0).toBe(5);
    expect(ymd(p?.start as Date)).toBe('2026-06-01');
    expect(ymd(p?.end as Date)).toBe('2026-06-30'); // last day of June
  });
  it('handles February + leap years for the end bound', () => {
    expect(ymd(parseMonth('2026-02')?.end as Date)).toBe('2026-02-28');
    expect(ymd(parseMonth('2028-02')?.end as Date)).toBe('2028-02-29'); // leap
  });
  it('rejects malformed or out-of-range months', () => {
    expect(parseMonth('2026-13')).toBeNull();
    expect(parseMonth('2026-00')).toBeNull();
    expect(parseMonth('2026-6')).toBeNull();
    expect(parseMonth('nope')).toBeNull();
    expect(parseMonth('')).toBeNull();
  });
});

describe('shiftMonth', () => {
  it('steps within a year', () => {
    expect(shiftMonth('2026-06', 1)).toBe('2026-07');
    expect(shiftMonth('2026-06', -1)).toBe('2026-05');
  });
  it('rolls over year boundaries', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });
});

describe('buildMonthGrid', () => {
  it('always returns 42 cells (6 weeks)', () => {
    expect(buildMonthGrid(2026, 5)).toHaveLength(42);
    expect(buildMonthGrid(2026, 1)).toHaveLength(42);
  });
  it('starts on the Sunday on/before the 1st and flags in-month cells', () => {
    // June 1 2026 is a Monday → grid starts Sunday May 31.
    const grid = buildMonthGrid(2026, 5);
    expect(grid[0]?.date).toBe('2026-05-31');
    expect(grid[0]?.inMonth).toBe(false);
    expect(grid.filter((c) => c.inMonth)).toHaveLength(30); // June has 30 days
    expect(grid.find((c) => c.date === '2026-06-01')?.inMonth).toBe(true);
    expect(grid.find((c) => c.date === '2026-06-30')?.inMonth).toBe(true);
  });
  it('every cell is consecutive', () => {
    const grid = buildMonthGrid(2026, 0);
    for (let i = 1; i < grid.length; i++) {
      const prev = new Date(`${grid[i - 1]?.date}T00:00:00.000Z`).getTime();
      const cur = new Date(`${grid[i]?.date}T00:00:00.000Z`).getTime();
      expect(cur - prev).toBe(86_400_000);
    }
  });
});

describe('indexEntriesByDate', () => {
  it('expands a single-day entry to one key', () => {
    const idx = indexEntriesByDate([entry('1', '2026-06-10', '2026-06-10')]);
    expect([...idx.keys()]).toEqual(['2026-06-10']);
    expect(idx.get('2026-06-10')).toHaveLength(1);
  });
  it('expands a multi-day range to every covered day (inclusive)', () => {
    const idx = indexEntriesByDate([entry('1', '2026-06-01', '2026-06-03')]);
    expect([...idx.keys()].sort()).toEqual(['2026-06-01', '2026-06-02', '2026-06-03']);
  });
  it('covers cross-month ranges', () => {
    const idx = indexEntriesByDate([entry('1', '2026-05-30', '2026-06-02')]);
    expect([...idx.keys()].sort()).toEqual([
      '2026-05-30',
      '2026-05-31',
      '2026-06-01',
      '2026-06-02',
    ]);
  });
  it('groups multiple entries that overlap a day', () => {
    const idx = indexEntriesByDate([
      entry('1', '2026-06-10', '2026-06-11'),
      entry('2', '2026-06-11', '2026-06-12'),
    ]);
    expect(
      idx
        .get('2026-06-11')
        ?.map((e) => e.leaveRequestId)
        .sort(),
    ).toEqual(['1', '2']);
  });
});

describe('indexAdvancesByDate / indexBirthdaysByDate', () => {
  it('groups advances by their single anchor day', () => {
    const advances: TeamCalendarAdvance[] = [
      {
        cashAdvanceId: 'a',
        employeeId: 'e',
        employeeName: 'A',
        shortLabel: 'A',
        amountLabel: '฿1',
        status: 'Approved',
        date: '2026-06-05',
      },
      {
        cashAdvanceId: 'b',
        employeeId: 'e2',
        employeeName: 'B',
        shortLabel: 'B',
        amountLabel: '฿2',
        status: 'Pending',
        date: '2026-06-05',
      },
    ];
    expect(indexAdvancesByDate(advances).get('2026-06-05')).toHaveLength(2);
  });
  it('groups birthdays by day', () => {
    const bdays: TeamCalendarBirthday[] = [
      { employeeId: 'e', employeeName: 'A', shortLabel: 'A', date: '2026-06-18' },
    ];
    expect(indexBirthdaysByDate(bdays).get('2026-06-18')).toHaveLength(1);
    expect(indexBirthdaysByDate([]).size).toBe(0);
  });
});

describe('formatThaiMonthLabel', () => {
  it('renders Thai month + Buddhist year', () => {
    expect(formatThaiMonthLabel(2026, 5)).toBe('มิถุนายน 2569');
    expect(formatThaiMonthLabel(2026, 0)).toBe('มกราคม 2569');
    expect(formatThaiMonthLabel(2026, 11)).toBe('ธันวาคม 2569');
  });
});

describe('currentMonthYM', () => {
  it('returns a well-formed YYYY-MM', () => {
    expect(currentMonthYM()).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
  });
});
