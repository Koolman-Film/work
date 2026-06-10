import { describe, expect, it } from 'vitest';
import {
  afternoonMinutes,
  formatDaysHours,
  type LeaveUnitConfig,
  leaveDurationLabel,
  minutesOf,
  morningMinutes,
  segmentFor,
  segmentsOverlap,
  standardDayMinutes,
  windowMinutes,
} from './units';

const CFG: LeaveUnitConfig = {
  morningStart: '09:00',
  morningEnd: '12:00',
  afternoonStart: '13:00',
  afternoonEnd: '17:00',
};

describe('time-of-day math', () => {
  it('minutesOf parses HH:MM to minutes-since-midnight', () => {
    expect(minutesOf('00:00')).toBe(0);
    expect(minutesOf('09:30')).toBe(570);
    expect(minutesOf('23:59')).toBe(1439);
  });

  it('windowMinutes is the difference', () => {
    expect(windowMinutes('09:00', '12:00')).toBe(180);
  });

  it('morning/afternoon/standard derive from the config', () => {
    expect(morningMinutes(CFG)).toBe(180); // 3h
    expect(afternoonMinutes(CFG)).toBe(240); // 4h
    expect(standardDayMinutes(CFG)).toBe(420); // 7h
  });
});

describe('formatDaysHours', () => {
  it('renders days, hours, and sub-hour minutes, omitting zero parts', () => {
    expect(formatDaysHours(0, CFG)).toBe('0 ชม.');
    expect(formatDaysHours(180, CFG)).toBe('3 ชม.'); // < 1 day
    expect(formatDaysHours(420, CFG)).toBe('1 วัน'); // exact day
    expect(formatDaysHours(600, CFG)).toBe('1 วัน 3 ชม.'); // 420 + 180
    expect(formatDaysHours(630, CFG)).toBe('1 วัน 3 ชม. 30 น.'); // 420 + 210
  });

  it('renders multiple whole days', () => {
    expect(formatDaysHours(840, CFG)).toBe('2 วัน'); // 420 * 2
    expect(formatDaysHours(1020, CFG)).toBe('2 วัน 3 ชม.'); // 840 + 180
  });
});

describe('segmentFor', () => {
  it('half-morning fills from config', () => {
    expect(segmentFor('HalfMorning', CFG)).toEqual({
      startTime: '09:00',
      endTime: '12:00',
      minutes: 180,
    });
  });

  it('half-afternoon fills from config', () => {
    expect(segmentFor('HalfAfternoon', CFG)).toEqual({
      startTime: '13:00',
      endTime: '17:00',
      minutes: 240,
    });
  });

  it('hourly uses the supplied times', () => {
    expect(segmentFor('Hourly', CFG, '14:00', '16:30')).toEqual({
      startTime: '14:00',
      endTime: '16:30',
      minutes: 150,
    });
  });

  it('full day has null times and one standard day of minutes', () => {
    expect(segmentFor('FullDay', CFG)).toEqual({
      startTime: null,
      endTime: null,
      minutes: 420,
    });
  });

  it('returns null for hourly without valid times', () => {
    expect(segmentFor('Hourly', CFG)).toBeNull();
    expect(segmentFor('Hourly', CFG, '16:00', '14:00')).toBeNull(); // end ≤ start
  });
});

describe('leaveDurationLabel', () => {
  // CFG: morning 3h + afternoon 4h = 7h standard day.
  it('full-day single date → whole days, not hours', () => {
    expect(leaveDurationLabel('FullDay', 1, CFG)).toBe('1 วัน');
  });

  it('full-day multi-day range → working-day count', () => {
    expect(leaveDurationLabel('FullDay', 3, CFG)).toBe('3 วัน');
  });

  it('half-afternoon shows the afternoon window hours, NOT "1 วัน" (regression)', () => {
    expect(leaveDurationLabel('HalfAfternoon', 1, CFG)).toBe('4 ชม.');
  });

  it('half-morning shows the morning window hours', () => {
    expect(leaveDurationLabel('HalfMorning', 1, CFG)).toBe('3 ชม.');
  });

  it('hourly uses the request times', () => {
    expect(leaveDurationLabel('Hourly', 1, CFG, '10:00', '12:30')).toBe('2 ชม. 30 น.');
  });

  it('zero working days (closed day) → zero charge', () => {
    expect(leaveDurationLabel('HalfAfternoon', 0, CFG)).toBe('0 ชม.');
  });

  it('falls back to the day count when stored times are invalid', () => {
    expect(leaveDurationLabel('Hourly', 1, CFG, '12:00', '10:00')).toBe('1 วัน');
  });
});

describe('segmentsOverlap', () => {
  it('null bounds mean whole-day → always overlaps', () => {
    expect(segmentsOverlap(null, null, '09:00', '10:00')).toBe(true);
    expect(segmentsOverlap('09:00', '10:00', null, null)).toBe(true);
  });

  it('disjoint AM/PM segments do not overlap', () => {
    expect(segmentsOverlap('09:00', '12:00', '13:00', '17:00')).toBe(false);
  });

  it('touching at a boundary does not overlap (half-open)', () => {
    expect(segmentsOverlap('09:00', '12:00', '12:00', '13:00')).toBe(false);
  });

  it('genuine overlap is detected', () => {
    expect(segmentsOverlap('09:00', '11:00', '10:00', '12:00')).toBe(true);
  });
});
