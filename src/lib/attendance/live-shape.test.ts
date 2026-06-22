import { describe, expect, it } from 'vitest';
import { type RosterEmployee, selectNotCheckedIn } from './live-shape';

const r = (id: string, scheduledToday = true): RosterEmployee => ({
  id,
  employeeName: id.toUpperCase(),
  employeeNickname: null,
  photoUrl: null,
  branchName: 'สาขา 1',
  scheduledToday,
});

const roster: RosterEmployee[] = [r('e1'), r('e2'), r('e3')];

describe('selectNotCheckedIn', () => {
  it('returns scheduled members who are not in the busy set', () => {
    const busy = new Set(['e2']); // e2 checked in or on leave
    expect(selectNotCheckedIn(roster, busy).map((x) => x.id)).toEqual(['e1', 'e3']);
  });

  it('returns the whole scheduled roster when nobody is busy', () => {
    expect(selectNotCheckedIn(roster, new Set()).map((x) => x.id)).toEqual(['e1', 'e2', 'e3']);
  });

  it('excludes employees not scheduled to work today (e.g. their day off)', () => {
    const mixed = [r('e1', true), r('e2', false), r('e3', true)];
    expect(selectNotCheckedIn(mixed, new Set()).map((x) => x.id)).toEqual(['e1', 'e3']);
  });
});
