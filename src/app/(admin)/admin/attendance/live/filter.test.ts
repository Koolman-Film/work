import { describe, expect, it } from 'vitest';
import type { LiveAttendanceRow, LiveBoardData } from '@/lib/attendance/live-shape';
import { isLate, parseFilter, selectView } from './filter';

function row(over: Partial<LiveAttendanceRow>): LiveAttendanceRow {
  return {
    id: 'r',
    employeeName: 'A A',
    employeeNickname: null,
    photoUrl: null,
    branchName: 'สาขา 1',
    clockInAt: '2026-06-08T01:00:00.000Z', // 08:00 Bangkok → not late
    clockOutAt: null,
    checkInStatus: 'Confirmed',
    isOverridden: false,
    ...over,
  };
}

const present = row({ id: 'present' });
const lateRow = row({ id: 'late', clockInAt: '2026-06-08T03:00:00.000Z' }); // 10:00 BKK
const outRow = row({ id: 'out', clockOutAt: '2026-06-08T10:00:00.000Z' });

const data: LiveBoardData = {
  rows: [present, lateRow, outRow],
  notCheckedIn: [
    { id: 'n1', employeeName: 'N N', employeeNickname: null, photoUrl: null, branchName: 'สาขา 1' },
  ],
  onLeave: [
    {
      id: 'l1',
      employeeName: 'L L',
      employeeNickname: null,
      photoUrl: null,
      branchName: 'สาขา 2',
      leaveTypeName: 'ลาป่วย',
      startDate: '2026-06-08T00:00:00.000Z',
      endDate: '2026-06-08T00:00:00.000Z',
    },
  ],
  activeCount: 4,
  onLeaveCount: 1,
  isClosedDay: false,
};

describe('parseFilter', () => {
  it('accepts the five known filters', () => {
    for (const f of ['checkedin', 'late', 'notcheckedin', 'onleave', 'checkedout']) {
      expect(parseFilter(f)).toBe(f);
    }
  });
  it('returns null for unknown / null input', () => {
    expect(parseFilter('bogus')).toBeNull();
    expect(parseFilter(null)).toBeNull();
  });
});

describe('isLate', () => {
  it('is true after 09:00 Bangkok and false at/under it', () => {
    expect(isLate('2026-06-08T03:00:00.000Z')).toBe(true); // 10:00
    expect(isLate('2026-06-08T01:00:00.000Z')).toBe(false); // 08:00
    expect(isLate(null)).toBe(false);
  });
  it('treats exactly 09:00 Bangkok as not late (> not >=)', () => {
    expect(isLate('2026-06-08T02:00:00.000Z')).toBe(false); // exactly 09:00 BKK
    expect(isLate('2026-06-08T02:01:00.000Z')).toBe(true); // 09:01 BKK
  });
});

describe('selectView', () => {
  it('default (null) shows all check-in rows', () => {
    const v = selectView(data, null);
    expect(v.kind).toBe('checkin');
    if (v.kind === 'checkin') expect(v.rows.map((r) => r.id)).toEqual(['present', 'late', 'out']);
  });
  it('late shows only late check-ins', () => {
    const v = selectView(data, 'late');
    expect(v.kind).toBe('checkin');
    if (v.kind === 'checkin') expect(v.rows.map((r) => r.id)).toEqual(['late']);
  });
  it('checkedout shows only checked-out rows', () => {
    const v = selectView(data, 'checkedout');
    if (v.kind === 'checkin') expect(v.rows.map((r) => r.id)).toEqual(['out']);
  });
  it('notcheckedin shows the roster list', () => {
    const v = selectView(data, 'notcheckedin');
    expect(v.kind).toBe('roster');
    if (v.kind === 'roster') expect(v.rows.map((r) => r.id)).toEqual(['n1']);
  });
  it('onleave shows the leave list', () => {
    const v = selectView(data, 'onleave');
    expect(v.kind).toBe('leave');
    if (v.kind === 'leave') expect(v.rows.map((r) => r.id)).toEqual(['l1']);
  });
});
