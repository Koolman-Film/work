import { describe, expect, it } from 'vitest';
import { type AbsenceDayInput, deriveAbsentMinutes } from './derive-absence';

const day = (o: Partial<AbsenceDayInput> = {}): AbsenceDayInput => ({
  scheduledMinutes: 480,
  leaveMinutes: 0,
  hasCheckIn: false,
  hasManualAbsent: false,
  isWorkday: true,
  ...o,
});

describe('deriveAbsentMinutes', () => {
  it('derives a whole scheduled day when nobody turned up and no leave covers it', () => {
    expect(deriveAbsentMinutes(day())).toBe(480);
  });

  it('derives nothing when they checked in — lateness and early-leave handle the rest', () => {
    expect(deriveAbsentMinutes(day({ hasCheckIn: true }))).toBe(0);
  });

  it('derives nothing on a non-workday (Sunday, holiday, or off their schedule)', () => {
    expect(deriveAbsentMinutes(day({ isWorkday: false }))).toBe(0);
  });

  it('derives only the uncovered part when a half-day leave covers the rest', () => {
    expect(deriveAbsentMinutes(day({ leaveMinutes: 180 }))).toBe(300);
  });

  it('derives nothing when leave covers the whole scheduled day', () => {
    expect(deriveAbsentMinutes(day({ leaveMinutes: 480 }))).toBe(0);
  });

  it('clamps to zero when leave exceeds the scheduled day', () => {
    expect(deriveAbsentMinutes(day({ leaveMinutes: 600 }))).toBe(0);
  });

  it('treats UNKNOWN leave duration as fully covered, never as uncovered', () => {
    // Production: 14 OnLeave rows have a null durationMinutes and every one is
    // อีฟ's approved maternity leave. Reading null as "0 minutes of leave"
    // would derive ~30 absent days against her. Under-deriving is recoverable;
    // deducting a month of maternity pay is not.
    expect(deriveAbsentMinutes(day({ leaveMinutes: null }))).toBe(0);
  });

  it('yields to an admin-keyed manual Absent row rather than double-counting it', () => {
    expect(deriveAbsentMinutes(day({ hasManualAbsent: true }))).toBe(0);
  });

  it('derives nothing when the day has no scheduled minutes', () => {
    expect(deriveAbsentMinutes(day({ scheduledMinutes: 0 }))).toBe(0);
  });
});
