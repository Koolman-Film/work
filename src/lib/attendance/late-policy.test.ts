import { describe, expect, it } from 'vitest';
import {
  bangkokMinutesOfDay,
  DEFAULT_LATE_POLICY,
  effectiveLateStartMin,
  hhmmToMinutes,
  lateMinutesForCheckIn,
  latePolicyFrom,
  resolveLatePolicy,
} from './late-policy';

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

// The lunch break every case below shares: 12:00–13:00, the gap between
// LeaveConfig.morningEnd and afternoonStart.
const LUNCH = { startMin: 12 * 60, endMin: 13 * 60 };
// A morning half-day leave 09:00–12:00, in minutes-of-day.
const MORNING_LEAVE = { startMin: 9 * 60, endMin: 12 * 60 };

describe('effectiveLateStartMin', () => {
  it('returns the scheduled start unchanged when nothing covers it', () => {
    expect(effectiveLateStartMin(540, [], null)).toBe(540); // 09:00
    expect(effectiveLateStartMin(540, [], LUNCH)).toBe(540); // lunch is later, irrelevant
  });

  it('a morning leave pushes the start past lunch to the afternoon start', () => {
    // 09:00 → (leave) 12:00 → (lands in lunch) 13:00
    expect(effectiveLateStartMin(540, [MORNING_LEAVE], LUNCH)).toBe(780); // 13:00
  });

  it('a morning leave with no configured lunch stops at the leave end', () => {
    expect(effectiveLateStartMin(540, [MORNING_LEAVE], null)).toBe(720); // 12:00
  });

  it('a leave that does NOT cover the scheduled start leaves it alone', () => {
    // Leave 10:00–12:00 — the 09:00–10:00 slice was still expected work.
    expect(effectiveLateStartMin(540, [{ startMin: 600, endMin: 720 }], LUNCH)).toBe(540);
  });

  it('chains a morning leave into a bridging afternoon-hour leave', () => {
    // 09:00 → (morning) 12:00 → (lunch) 13:00 → (13:00–14:00 leave) 14:00
    const hourly = { startMin: 780, endMin: 840 };
    expect(effectiveLateStartMin(540, [MORNING_LEAVE, hourly], LUNCH)).toBe(840); // 14:00
  });
});

describe('lateMinutesForCheckIn with approved leave + lunch break', () => {
  const ctx = { leaveWindows: [MORNING_LEAVE], breakWindow: LUNCH };

  it('morning leave + check-in during lunch → 0 (the reported bug)', () => {
    // ภัทธริดา: leave 09:00–12:00, checked in 12:16 — was shown "3 ชม. 16 นาที".
    expect(lateMinutesForCheckIn(bkk('12:16'), DEFAULT_LATE_POLICY, ctx)).toBe(0);
    // กมล: leave 09:00–12:00, checked in 12:01 — was shown "3 ชม. 1 นาที".
    expect(lateMinutesForCheckIn(bkk('12:01'), DEFAULT_LATE_POLICY, ctx)).toBe(0);
  });

  it('morning leave + check-in just after lunch, within grace → 0', () => {
    expect(lateMinutesForCheckIn(bkk('13:10'), DEFAULT_LATE_POLICY, ctx)).toBe(0); // 10 ≤ 15
  });

  it('morning leave + check-in well after lunch, past grace → late from 13:00', () => {
    expect(lateMinutesForCheckIn(bkk('13:20'), DEFAULT_LATE_POLICY, ctx)).toBe(20);
  });

  it('a full-day leave is never late, whenever they check in', () => {
    expect(lateMinutesForCheckIn(bkk('15:00'), DEFAULT_LATE_POLICY, { fullDayLeave: true })).toBe(
      0,
    );
  });

  it('no leave context → identical to the plain policy (no regression)', () => {
    expect(lateMinutesForCheckIn(bkk('09:30'), DEFAULT_LATE_POLICY, { breakWindow: LUNCH })).toBe(
      30,
    );
    expect(lateMinutesForCheckIn(bkk('09:30'))).toBe(30);
  });
});

describe('latePolicyFrom', () => {
  it('uses config values when present', () => {
    expect(latePolicyFrom({ workStartTime: '08:30', lateGraceMinutes: 5 })).toEqual({
      startTime: '08:30',
      graceMin: 5,
    });
    // grace of 0 is a real value, not "missing"
    expect(latePolicyFrom({ workStartTime: '08:30', lateGraceMinutes: 0 }).graceMin).toBe(0);
  });
  it('falls back to defaults for null config / fields', () => {
    expect(latePolicyFrom(null)).toEqual(DEFAULT_LATE_POLICY);
    expect(latePolicyFrom({ workStartTime: null, lateGraceMinutes: null })).toEqual(
      DEFAULT_LATE_POLICY,
    );
  });
});

describe('resolveLatePolicy', () => {
  const company = { startTime: '09:00', graceMin: 15 };
  // Mon/Wed/Fri schedule, each day starting 08:30, with a 10-min tolerance.
  const days = [
    { dayOfWeek: 1, startTime: '08:30' },
    { dayOfWeek: 3, startTime: '08:30' },
    { dayOfWeek: 5, startTime: '08:30' },
  ];

  it("uses the employee's schedule start + tolerance on a scheduled day", () => {
    expect(resolveLatePolicy(days, 10, 1, company)).toEqual({ startTime: '08:30', graceMin: 10 });
  });

  it('returns null on an off-schedule day (never late)', () => {
    expect(resolveLatePolicy(days, 10, 6, company)).toBeNull(); // Saturday
  });

  it('falls back to the company default when no schedule', () => {
    expect(resolveLatePolicy(null, null, 6, company)).toEqual(company);
    expect(resolveLatePolicy([], 10, 1, company)).toEqual(company);
  });

  it('uses the company grace when the schedule has none', () => {
    expect(resolveLatePolicy(days, null, 3, company)).toEqual({ startTime: '08:30', graceMin: 15 });
  });
});
