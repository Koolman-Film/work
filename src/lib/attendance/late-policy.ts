/**
 * Company late-arrival policy.
 *
 * Lateness = a check-in whose Bangkok clock-in time is later than the
 * scheduled start by more than the grace window. The "Late" attendance row
 * the rest of the system reads (report, history filter, payroll deduction)
 * is derived from this.
 *
 * For now the start time + grace are a single COMPANY DEFAULT, because no
 * employee currently has a per-employee WorkSchedule assigned (0 of 9 in the
 * data). When schedules get wired up, pass a per-employee {startTime,graceMin}
 * into `lateMinutesForCheckIn` instead of the default.
 *
 * Pure + dependency-free so it unit-tests without a DB or request context.
 */

/** Company default scheduled start, "HH:MM" in Asia/Bangkok. */
export const DEFAULT_WORK_START = '09:00';
/** Minutes after the start before a check-in counts as Late (matches the
 *  seeded WorkSchedule.lateToleranceMin default). */
export const DEFAULT_LATE_GRACE_MIN = 15;

export type LatePolicy = { startTime: string; graceMin: number };

export const DEFAULT_LATE_POLICY: LatePolicy = {
  startTime: DEFAULT_WORK_START,
  graceMin: DEFAULT_LATE_GRACE_MIN,
};

/** Parse "HH:MM" (24h) to minutes-of-day, or null if malformed/out of range. */
export function hhmmToMinutes(hhmm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Minutes-of-day (0–1439) of a UTC instant, read in Asia/Bangkok. */
export function bangkokMinutesOfDay(at: Date): number {
  const hhmm = at.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
  const minutes = hhmmToMinutes(hhmm);
  return minutes ?? 0;
}

/**
 * Minutes late for a check-in, measured from the scheduled start
 * (clockIn − start) — but only once the lateness exceeds the grace window.
 * Returns 0 when on time or within grace.
 *
 * Example (start 09:00, grace 15): 09:14 → 0, 09:15 → 0, 09:16 → 16, 11:14 → 134.
 *
 * NOTE: this does NOT know about closed days (Sundays / holidays). The caller
 * decides whether the day is a working day before recording a Late row.
 */
export function lateMinutesForCheckIn(
  clockInAt: Date,
  policy: LatePolicy = DEFAULT_LATE_POLICY,
): number {
  const start = hhmmToMinutes(policy.startTime);
  if (start == null) return 0;
  const lateBy = bangkokMinutesOfDay(clockInAt) - start;
  return lateBy > policy.graceMin ? lateBy : 0;
}
