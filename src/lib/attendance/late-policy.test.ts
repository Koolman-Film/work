import { describe, expect, it } from 'vitest';
import { bangkokMinutesOfDay, hhmmToMinutes, lateMinutesForCheckIn } from './late-policy';

/** Helper: a UTC instant for a given Bangkok wall-clock "HH:MM" on 2026-06-12.
 *  Bangkok is UTC+7, so subtract 7h to get the UTC instant. */
function bkk(hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 5, 12, (h as number) - 7, m as number, 0));
}

describe('hhmmToMinutes', () => {
  it('parses valid times', () => {
    expect(hhmmToMinutes('09:00')).toBe(540);
    expect(hhmmToMinutes('00:00')).toBe(0);
    expect(hhmmToMinutes('23:59')).toBe(1439);
  });
  it('rejects malformed / out-of-range', () => {
    expect(hhmmToMinutes('9:00')).toBeNull();
    expect(hhmmToMinutes('24:00')).toBeNull();
    expect(hhmmToMinutes('09:60')).toBeNull();
    expect(hhmmToMinutes('')).toBeNull();
  });
});

describe('bangkokMinutesOfDay', () => {
  it('reads the Bangkok wall-clock time of a UTC instant', () => {
    expect(bangkokMinutesOfDay(bkk('09:03'))).toBe(9 * 60 + 3);
    expect(bangkokMinutesOfDay(bkk('00:00'))).toBe(0);
  });
});

describe('lateMinutesForCheckIn (default 09:00 + 15 grace)', () => {
  it('on time → 0', () => {
    expect(lateMinutesForCheckIn(bkk('08:55'))).toBe(0);
    expect(lateMinutesForCheckIn(bkk('09:00'))).toBe(0);
  });
  it('within grace → 0 (09:03, 09:15 are NOT late with a 15-min grace)', () => {
    expect(lateMinutesForCheckIn(bkk('09:03'))).toBe(0);
    expect(lateMinutesForCheckIn(bkk('09:15'))).toBe(0);
  });
  it('past grace → minutes measured from the scheduled start', () => {
    expect(lateMinutesForCheckIn(bkk('09:16'))).toBe(16);
    expect(lateMinutesForCheckIn(bkk('11:14'))).toBe(134);
  });
  it('honors a custom policy (zero grace flags any minute past start)', () => {
    expect(lateMinutesForCheckIn(bkk('09:03'), { startTime: '09:00', graceMin: 0 })).toBe(3);
  });
});
