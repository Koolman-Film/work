import { describe, expect, it } from 'vitest';
import { type AbsenceDayInput, deriveAbsentMinutes, scheduledWorkMinutes } from './derive-absence';

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

/**
 * A WorkScheduleDay window and a LeaveConfig day measure different things:
 * production's schedule is 09:00–18:00 (540 min, lunch included) while its
 * standard leave day is 480 min (09:00–12:00 + 13:00–18:00, lunch excluded).
 * Subtracting one from the other leaves a phantom 60-minute absence for every
 * full day of leave anyone takes — visible on 8 employees in the first
 * production preview. Both sides must be measured on the same basis.
 */
describe('scheduledWorkMinutes', () => {
  const BREAK = { start: '12:00', end: '13:00' };

  it("removes the unpaid break so a schedule day matches a leave day's basis", () => {
    // Production's real shape: 09:00–18:00 minus the 12:00–13:00 break = 480,
    // exactly the LeaveConfig standard day a full-day leave records.
    expect(scheduledWorkMinutes('09:00', '18:00', BREAK)).toBe(480);
  });

  it('subtracts only the overlap for a shift ending inside the break', () => {
    expect(scheduledWorkMinutes('09:00', '12:30', BREAK)).toBe(180);
  });

  it('subtracts nothing from a morning-only shift that never reaches the break', () => {
    expect(scheduledWorkMinutes('09:00', '12:00', BREAK)).toBe(180);
  });

  it('subtracts nothing from an afternoon-only shift that starts after the break', () => {
    expect(scheduledWorkMinutes('13:00', '18:00', BREAK)).toBe(300);
  });

  it('subtracts nothing when no break is configured', () => {
    expect(scheduledWorkMinutes('09:00', '18:00', null)).toBe(540);
  });

  it('never returns negative for a shift wholly inside the break', () => {
    expect(scheduledWorkMinutes('12:10', '12:40', BREAK)).toBe(0);
  });
});
