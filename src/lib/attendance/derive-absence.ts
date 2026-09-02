/**
 * How many minutes of a scheduled day an employee was absent for — derived,
 * never stored.
 *
 * Absence does not exist in this system today: `Absent` rows are created in
 * exactly one place, the admin manual-entry form, and payroll deducts only what
 * was keyed by hand. This is the pure core of deriving it instead, so that
 * "ไม่ได้เช็คอิน / ไม่ลา แต่ระบบไม่ขึ้นว่า ขาดงาน" stops depending on somebody
 * remembering.
 *
 * Derived rather than stored so it self-corrects: approve leave retroactively
 * and the absence disappears on the next read, with no backfill. Same
 * derive-on-read model as `computeLiveLeaveCharges`.
 */

export type AbsenceDayInput = {
  /** Minutes the employee's WorkSchedule says they work on this weekday. */
  scheduledMinutes: number;
  /**
   * Minutes of approved leave covering this date, or `null` when leave exists
   * but its duration was never recorded. Null is NOT zero — see below.
   */
  leaveMinutes: number | null;
  /** Any CheckIn row for the date: they turned up, so this is not an absence. */
  hasCheckIn: boolean;
  /** An admin keyed an Absent row for this date — their word beats inference. */
  hasManualAbsent: boolean;
  /** A scheduled working day: not Sunday, not a holiday, on their schedule. */
  isWorkday: boolean;
};

export function deriveAbsentMinutes(input: AbsenceDayInput): number {
  if (!input.isWorkday) return 0;
  if (input.hasCheckIn) return 0;
  // The admin's explicit statement wins over the inference, so the two can
  // never both charge for the same date.
  if (input.hasManualAbsent) return 0;
  // Unknown leave duration counts as FULL coverage, deliberately. Production
  // has 14 OnLeave rows with a null durationMinutes and all of them are one
  // employee's approved maternity leave; reading null as "no leave" would
  // derive her as absent for the whole of it. An under-derived day can still be
  // keyed by hand — a wrongly deducted month of maternity pay cannot be undone
  // as easily.
  if (input.leaveMinutes === null) return 0;
  return Math.max(0, input.scheduledMinutes - input.leaveMinutes);
}

/** The unpaid gap between the morning and afternoon leave windows, "HH:MM". */
export type BreakWindow = { start: string; end: string };

const mins = (hhmm: string) => {
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
};

/**
 * Minutes an employee is actually scheduled to WORK on a given day, on the same
 * basis leave is measured in.
 *
 * These two disagree by default and the difference is money. A
 * `WorkScheduleDay` window is wall-clock and includes the unpaid break —
 * production's is 09:00–18:00, 540 minutes. A `LeaveConfig` standard day
 * deliberately excludes it — 09:00–12:00 plus 13:00–18:00, 480 minutes. Subtract
 * a full day of leave (480) from a raw schedule window (540) and you are left
 * with a phantom 60-minute absence for every full day of leave anyone takes; the
 * first production preview showed exactly that on 8 employees.
 *
 * Subtracts the OVERLAP rather than a flat break length, so a morning-only or
 * afternoon-only shift that never spans the break loses nothing.
 */
export function scheduledWorkMinutes(
  startTime: string,
  endTime: string,
  brk: BreakWindow | null,
): number {
  const span = Math.max(0, mins(endTime) - mins(startTime));
  if (!brk) return span;
  const overlap = Math.max(
    0,
    Math.min(mins(endTime), mins(brk.end)) - Math.max(mins(startTime), mins(brk.start)),
  );
  return Math.max(0, span - overlap);
}
