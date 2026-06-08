import { describe, expect, it } from 'vitest';
import {
  afternoonMinutes,
  formatDaysHours,
  type LeaveUnitConfig,
  minutesOf,
  morningMinutes,
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
  it('renders days + hours + minutes against the standard day', () => {
    expect(formatDaysHours(0, CFG)).toBe('0 ชม.');
    expect(formatDaysHours(180, CFG)).toBe('3 ชม.'); // < 1 day
    expect(formatDaysHours(420, CFG)).toBe('1 วัน'); // exact day
    expect(formatDaysHours(600, CFG)).toBe('1 วัน 3 ชม.'); // 420 + 180
    expect(formatDaysHours(630, CFG)).toBe('1 วัน 3 ชม. 30 น.'); // 420 + 210
  });
});
