import { describe, expect, it } from 'vitest';
import { bangkokDateUtcMidnight, isClosedDay } from './date';

describe('bangkokDateUtcMidnight', () => {
  it('maps a Bangkok-evening instant to that local date at UTC midnight', () => {
    // 2026-06-08 23:30 in Bangkok (UTC+7) is still 2026-06-08 locally,
    // even though in UTC it is already 2026-06-08T16:30Z.
    const d = new Date('2026-06-08T16:30:00.000Z');
    expect(bangkokDateUtcMidnight(d).toISOString()).toBe('2026-06-08T00:00:00.000Z');
  });

  it('rolls to the next local date once Bangkok passes midnight', () => {
    // 2026-06-08T17:30Z == 2026-06-09T00:30 Bangkok → local date is the 9th.
    const d = new Date('2026-06-08T17:30:00.000Z');
    expect(bangkokDateUtcMidnight(d).toISOString()).toBe('2026-06-09T00:00:00.000Z');
  });
});

describe('isClosedDay', () => {
  it('is true on a Sunday (UTC-midnight date)', () => {
    // 2026-06-07 is a Sunday.
    expect(isClosedDay(new Date('2026-06-07T00:00:00.000Z'), false)).toBe(true);
  });

  it('is true on a holiday even when not Sunday', () => {
    // 2026-06-08 is a Monday.
    expect(isClosedDay(new Date('2026-06-08T00:00:00.000Z'), true)).toBe(true);
  });

  it('is false on a normal working day with no holiday', () => {
    expect(isClosedDay(new Date('2026-06-08T00:00:00.000Z'), false)).toBe(false);
  });
});
