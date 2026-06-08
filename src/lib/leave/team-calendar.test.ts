/**
 * Tests for the pure month-math + entry-indexing helpers in
 * team-calendar.ts. Focuses on the off-by-one traps:
 *   - Sunday-leading vs Monday-leading padding
 *   - Cross-month leave (Feb 28 → Mar 2 must appear on both views)
 *   - Year boundary (Dec → Jan)
 *   - Leap year (Feb 29 2028 — the next leap)
 */

import { describe, expect, it } from 'vitest';
import {
  buildMonthGrid,
  formatThaiMonthLabel,
  indexAdvancesByDate,
  indexEntriesByDate,
  parseMonth,
  shiftMonth,
  type TeamCalendarAdvance,
  type TeamCalendarEntry,
} from './team-calendar-shape';

describe('parseMonth', () => {
  it('parses a valid YYYY-MM', () => {
    const r = parseMonth('2026-05');
    expect(r).not.toBeNull();
    expect(r?.year).toBe(2026);
    expect(r?.month0).toBe(4); // May = 0-indexed 4
    expect(r?.start.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    // Day 0 of June = May 31 → last day of May.
    expect(r?.end.toISOString()).toBe('2026-05-31T00:00:00.000Z');
  });

  it('parses December correctly (no year overflow on end)', () => {
    const r = parseMonth('2026-12');
    expect(r?.end.toISOString()).toBe('2026-12-31T00:00:00.000Z');
  });

  it('parses February in a leap year (29 days)', () => {
    const r = parseMonth('2028-02');
    expect(r?.end.toISOString()).toBe('2028-02-29T00:00:00.000Z');
  });

  it('returns null for malformed input', () => {
    expect(parseMonth('2026/05')).toBeNull();
    expect(parseMonth('2026-13')).toBeNull();
    expect(parseMonth('2026-00')).toBeNull();
    expect(parseMonth('abc')).toBeNull();
    expect(parseMonth('')).toBeNull();
  });
});

describe('shiftMonth', () => {
  it('moves forward one month', () => {
    expect(shiftMonth('2026-05', 1)).toBe('2026-06');
  });
  it('moves backward one month', () => {
    expect(shiftMonth('2026-05', -1)).toBe('2026-04');
  });
  it('rolls forward across year boundary', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  });
  it('rolls backward across year boundary', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });
});

describe('buildMonthGrid', () => {
  it('always produces 42 cells (6×7)', () => {
    const grid = buildMonthGrid(2026, 4); // May 2026
    expect(grid).toHaveLength(42);
  });

  it('pads with previous-month days when the 1st is mid-week', () => {
    // May 1 2026 is a Friday. Sunday-first grid → 5 leading days.
    // Non-null assertions are safe here: buildMonthGrid contractually
    // returns 42 cells, but TS doesn't see that under noUncheckedIndexedAccess.
    const grid = buildMonthGrid(2026, 4);
    expect(grid[0]!.inMonth).toBe(false);
    expect(grid[5]!.inMonth).toBe(true);
    expect(grid[5]!.date).toBe('2026-05-01');
    expect(grid[5]!.day).toBe(1);
  });

  it('starts cleanly when the 1st is a Sunday', () => {
    // March 1 2026 is a Sunday. Grid starts directly with March 1.
    const grid = buildMonthGrid(2026, 2);
    expect(grid[0]!.inMonth).toBe(true);
    expect(grid[0]!.date).toBe('2026-03-01');
    expect(grid[0]!.day).toBe(1);
  });

  it('pads trailing days from next month so total cell count = 42', () => {
    // May 2026 has 31 days, leads with 5 padding → 36 cells filled,
    // so 6 trailing days from June must appear.
    const grid = buildMonthGrid(2026, 4);
    const trailing = grid.filter((g) => !g.inMonth && g.date >= '2026-06-01');
    expect(trailing).toHaveLength(6);
    expect(trailing[0]!.date).toBe('2026-06-01');
  });

  it('handles year-end rollover (Dec 2026 → Jan 2027 padding)', () => {
    const grid = buildMonthGrid(2026, 11); // December 2026
    const trailing = grid.filter((g) => !g.inMonth && g.date.startsWith('2027'));
    expect(trailing.length).toBeGreaterThan(0);
    expect(trailing[0]!.date).toBe('2027-01-01');
  });
});

describe('indexEntriesByDate', () => {
  const baseEntry: Omit<TeamCalendarEntry, 'startDate' | 'endDate' | 'leaveRequestId'> = {
    employeeId: 'emp-1',
    employeeName: 'Alice Smith',
    shortLabel: 'Alice',
    leaveTypeName: 'ลาพักร้อน',
    status: 'Approved',
    isMine: false,
  };

  it('expands a single-day leave to one date key', () => {
    const idx = indexEntriesByDate([
      { ...baseEntry, leaveRequestId: 'l1', startDate: '2026-05-15', endDate: '2026-05-15' },
    ]);
    expect(idx.size).toBe(1);
    expect(idx.get('2026-05-15')?.length).toBe(1);
  });

  it('expands a multi-day leave to every date key in range', () => {
    const idx = indexEntriesByDate([
      { ...baseEntry, leaveRequestId: 'l1', startDate: '2026-05-13', endDate: '2026-05-15' },
    ]);
    expect(idx.size).toBe(3);
    expect(idx.has('2026-05-13')).toBe(true);
    expect(idx.has('2026-05-14')).toBe(true);
    expect(idx.has('2026-05-15')).toBe(true);
  });

  it('groups multiple employees on the same day', () => {
    const idx = indexEntriesByDate([
      { ...baseEntry, leaveRequestId: 'l1', startDate: '2026-05-15', endDate: '2026-05-15' },
      {
        ...baseEntry,
        leaveRequestId: 'l2',
        employeeId: 'emp-2',
        shortLabel: 'Bob',
        startDate: '2026-05-15',
        endDate: '2026-05-15',
      },
    ]);
    expect(idx.get('2026-05-15')?.length).toBe(2);
  });

  it('handles a leave that crosses a month boundary', () => {
    // Feb 27 → Mar 2 2026 — 4 days.
    const idx = indexEntriesByDate([
      { ...baseEntry, leaveRequestId: 'l1', startDate: '2026-02-27', endDate: '2026-03-02' },
    ]);
    expect(idx.size).toBe(4);
    expect(idx.has('2026-02-27')).toBe(true);
    expect(idx.has('2026-02-28')).toBe(true);
    expect(idx.has('2026-03-01')).toBe(true);
    expect(idx.has('2026-03-02')).toBe(true);
  });
});

describe('formatThaiMonthLabel', () => {
  it('formats month name + Buddhist year (June 2026 → 2569 BE)', () => {
    expect(formatThaiMonthLabel(2026, 5)).toBe('มิถุนายน 2569');
  });
  it('formats January', () => {
    expect(formatThaiMonthLabel(2027, 0)).toBe('มกราคม 2570');
  });
  it('formats December', () => {
    expect(formatThaiMonthLabel(2026, 11)).toBe('ธันวาคม 2569');
  });
});

describe('indexAdvancesByDate', () => {
  const base: Omit<TeamCalendarAdvance, 'cashAdvanceId' | 'date'> = {
    employeeId: 'emp-1',
    employeeName: 'Alice Smith',
    shortLabel: 'Alice',
    amountLabel: '฿1,500.00',
    status: 'Pending',
  };

  it('keys an advance on its single anchor day', () => {
    const idx = indexAdvancesByDate([{ ...base, cashAdvanceId: 'a1', date: '2026-06-08' }]);
    expect(idx.size).toBe(1);
    expect(idx.get('2026-06-08')?.length).toBe(1);
  });

  it('groups multiple advances on the same day', () => {
    const idx = indexAdvancesByDate([
      { ...base, cashAdvanceId: 'a1', date: '2026-06-08' },
      { ...base, cashAdvanceId: 'a2', employeeId: 'emp-2', date: '2026-06-08' },
    ]);
    expect(idx.get('2026-06-08')?.length).toBe(2);
  });

  it('returns an empty map for no advances', () => {
    expect(indexAdvancesByDate([]).size).toBe(0);
  });
});
