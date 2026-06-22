import { describe, expect, it } from 'vitest';
import { isScheduledWorkday } from './schedule';

describe('isScheduledWorkday', () => {
  const monWedFri = [1, 3, 5]; // พี่แดง's schedule

  it('respects a custom schedule', () => {
    expect(isScheduledWorkday(monWedFri, 1, false)).toBe(true); // Monday → works
    expect(isScheduledWorkday(monWedFri, 6, false)).toBe(false); // Saturday → off (the bug)
    expect(isScheduledWorkday(monWedFri, 2, false)).toBe(false); // Tuesday → off
  });

  it('never expects work on a holiday, even on a scheduled day', () => {
    expect(isScheduledWorkday(monWedFri, 1, true)).toBe(false);
  });

  it('falls back to the company week (Mon–Sat) when no schedule is set', () => {
    expect(isScheduledWorkday(null, 6, false)).toBe(true); // Saturday → works (default)
    expect(isScheduledWorkday(null, 0, false)).toBe(false); // Sunday → off (default)
    expect(isScheduledWorkday([], 3, false)).toBe(true); // empty == no schedule
  });
});
