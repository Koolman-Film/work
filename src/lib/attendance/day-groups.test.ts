import { describe, expect, it } from 'vitest';
import { groupByEmployeeDay } from './day-groups';

const row = (employeeId: string, date: string, type: string) => ({
  id: `${employeeId}-${date}-${type}`,
  employeeId,
  date: new Date(`${date}T00:00:00.000Z`),
  type,
});

describe('groupByEmployeeDay', () => {
  it('puts a check-in and its late row in one group', () => {
    const g = groupByEmployeeDay([
      row('e1', '2026-08-20', 'CheckIn'),
      row('e1', '2026-08-20', 'Late'),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]?.rows).toHaveLength(2);
  });

  it('keeps different employees on the same date apart', () => {
    const g = groupByEmployeeDay([
      row('e1', '2026-08-20', 'CheckIn'),
      row('e2', '2026-08-20', 'CheckIn'),
    ]);
    expect(g).toHaveLength(2);
  });

  it('keeps the same employee on different dates apart', () => {
    const g = groupByEmployeeDay([
      row('e1', '2026-08-20', 'CheckIn'),
      row('e1', '2026-08-21', 'CheckIn'),
    ]);
    expect(g).toHaveLength(2);
  });

  it('preserves the incoming order of groups', () => {
    // The page orders by date desc; grouping must not silently re-sort into an
    // order the filters do not imply.
    const g = groupByEmployeeDay([
      row('e1', '2026-08-21', 'CheckIn'),
      row('e1', '2026-08-20', 'CheckIn'),
    ]);
    expect(g[0]?.ymd).toBe('2026-08-21');
    expect(g[1]?.ymd).toBe('2026-08-20');
  });

  it('preserves row order WITHIN a group', () => {
    const g = groupByEmployeeDay([
      row('e1', '2026-08-20', 'CheckIn'),
      row('e1', '2026-08-20', 'Late'),
      row('e1', '2026-08-20', 'EarlyLeave'),
    ]);
    expect(g[0]?.rows.map((r) => r.type)).toEqual(['CheckIn', 'Late', 'EarlyLeave']);
  });

  it('an OnLeave day with no check-in is still a group', () => {
    const g = groupByEmployeeDay([row('e1', '2026-08-20', 'OnLeave')]);
    expect(g).toHaveLength(1);
  });

  it('a row interleaved from another employee still joins its own group', () => {
    // Rows arrive ordered by date, not by employee, so a group's members are
    // not necessarily adjacent.
    const g = groupByEmployeeDay([
      row('e1', '2026-08-20', 'CheckIn'),
      row('e2', '2026-08-20', 'CheckIn'),
      row('e1', '2026-08-20', 'Late'),
    ]);
    expect(g).toHaveLength(2);
    expect(g[0]?.rows).toHaveLength(2);
    expect(g[0]?.employeeId).toBe('e1');
  });

  it('an empty list yields no groups', () => {
    expect(groupByEmployeeDay([])).toEqual([]);
  });
});
