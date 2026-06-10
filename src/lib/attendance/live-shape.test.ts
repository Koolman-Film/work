import { describe, expect, it } from 'vitest';
import { type RosterEmployee, selectNotCheckedIn } from './live-shape';

const roster: RosterEmployee[] = [
  { id: 'e1', employeeName: 'A A', employeeNickname: null, photoUrl: null, branchName: 'สาขา 1' },
  { id: 'e2', employeeName: 'B B', employeeNickname: 'บี', photoUrl: null, branchName: 'สาขา 1' },
  { id: 'e3', employeeName: 'C C', employeeNickname: null, photoUrl: null, branchName: 'สาขา 2' },
];

describe('selectNotCheckedIn', () => {
  it('returns roster members who are not in the busy set', () => {
    const busy = new Set(['e2']); // e2 checked in or on leave
    expect(selectNotCheckedIn(roster, busy, false).map((r) => r.id)).toEqual(['e1', 'e3']);
  });

  it('returns the whole roster when nobody is busy', () => {
    expect(selectNotCheckedIn(roster, new Set(), false).map((r) => r.id)).toEqual([
      'e1',
      'e2',
      'e3',
    ]);
  });

  it('returns an empty list on a closed day regardless of the busy set', () => {
    expect(selectNotCheckedIn(roster, new Set(), true)).toEqual([]);
  });
});
