import { describe, expect, it } from 'vitest';
import {
  adjustmentDisplay,
  adjustmentToMinutes,
  afternoonMinutes,
  formatDaysHours,
  formatDurationParts,
  type LeaveUnitConfig,
  leaveDurationLabel,
  minutesInUnit,
  minutesOf,
  morningMinutes,
  segmentFor,
  segmentsOverlap,
  splitDaysHours,
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

describe('splitDaysHours + formatDurationParts', () => {
  it('splits minutes into days/hours/mins using the standard day', () => {
    expect(splitDaysHours(0, CFG)).toEqual({ days: 0, hours: 0, mins: 0 });
    expect(splitDaysHours(600, CFG)).toEqual({ days: 1, hours: 3, mins: 0 }); // 420 + 180
    expect(splitDaysHours(630, CFG)).toEqual({ days: 1, hours: 3, mins: 30 });
  });

  it('renders with caller-supplied unit labels (locale-aware path)', () => {
    const en = {
      day: (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`,
      hour: (n: number) => `${n} hr`,
      min: (n: number) => `${n} min`,
    };
    expect(formatDurationParts(splitDaysHours(600, CFG), en)).toBe('1 day 3 hr');
    expect(formatDurationParts(splitDaysHours(630, CFG), en)).toBe('1 day 3 hr 30 min');
    expect(formatDurationParts(splitDaysHours(0, CFG), en)).toBe('0 hr');
  });
});

// Adjustment unit conversion for the entitlement editor's วัน/ชม. toggle.
// std = standardDayMinutes; 480 (8h day) used for readable arithmetic.
describe('adjustmentToMinutes', () => {
  it('converts a day value to minutes (× standard day)', () => {
    expect(adjustmentToMinutes(-3.5, 'day', 480)).toBe(-1680);
    expect(adjustmentToMinutes(0.5, 'day', 480)).toBe(240);
    expect(adjustmentToMinutes(-3.5, 'day', 420)).toBe(-1470); // 7h day
  });

  it('converts an hour value to minutes (× 60), independent of day length', () => {
    expect(adjustmentToMinutes(-1, 'hour', 480)).toBe(-60);
    expect(adjustmentToMinutes(-28, 'hour', 480)).toBe(-1680);
    expect(adjustmentToMinutes(2.5, 'hour', 420)).toBe(150);
  });

  it('rounds to the nearest minute', () => {
    expect(adjustmentToMinutes(0.01, 'hour', 480)).toBe(1); // 0.6 → 1
  });
});

describe('minutesInUnit', () => {
  it('expresses minutes in the requested unit', () => {
    expect(minutesInUnit(-1680, 'day', 480)).toBe(-3.5);
    expect(minutesInUnit(-1680, 'hour', 480)).toBe(-28);
    expect(minutesInUnit(-60, 'hour', 480)).toBe(-1);
    expect(minutesInUnit(240, 'day', 480)).toBe(0.5);
  });
});

describe('adjustmentDisplay', () => {
  it('shows whole/half-day adjustments in วัน (existing values unchanged)', () => {
    expect(adjustmentDisplay(-1680, 480)).toEqual({ value: -3.5, unit: 'day' });
    expect(adjustmentDisplay(-240, 480)).toEqual({ value: -0.5, unit: 'day' });
    expect(adjustmentDisplay(0, 480)).toEqual({ value: 0, unit: 'day' });
    expect(adjustmentDisplay(-1470, 420)).toEqual({ value: -3.5, unit: 'day' }); // 7h day
  });

  it('shows sub-half-day (hour-precision) adjustments in ชม.', () => {
    expect(adjustmentDisplay(-60, 480)).toEqual({ value: -1, unit: 'hour' });
    expect(adjustmentDisplay(-120, 480)).toEqual({ value: -2, unit: 'hour' });
    expect(adjustmentDisplay(90, 480)).toEqual({ value: 1.5, unit: 'hour' });
  });

  it('round-trips exactly: display → toMinutes recovers the stored minutes', () => {
    for (const m of [-1680, -240, -60, -120, 90, 0, 210, 1470]) {
      const std = 480;
      const d = adjustmentDisplay(m, std);
      expect(adjustmentToMinutes(d.value, d.unit, std)).toBe(m);
    }
  });
});
