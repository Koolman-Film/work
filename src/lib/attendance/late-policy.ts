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

/**
 * Build a LatePolicy from the (admin-editable) PayrollConfig fields, falling
 * back to the company defaults when the config row or a field is missing.
 * Pure — callers read PayrollConfig and pass it here.
 */
export function latePolicyFrom(
  cfg: { workStartTime?: string | null; lateGraceMinutes?: number | null } | null,
): LatePolicy {
  return {
    startTime: cfg?.workStartTime ?? DEFAULT_WORK_START,
    graceMin: cfg?.lateGraceMinutes ?? DEFAULT_LATE_GRACE_MIN,
  };
}

export type ScheduleDay = { dayOfWeek: number; startTime: string };

/**
 * Resolve which LatePolicy applies to an employee on a given weekday:
 *  - HAS a WorkSchedule → today's `WorkScheduleDay.startTime` + the schedule's
 *    `lateToleranceMin`. Returns **null** when today isn't one of their
 *    scheduled days (they're off → never late, even if they check in).
 *  - no schedule → the `companyDefault` (PayrollConfig).
 *
 * @param dow 0=Sun … 6=Sat (the check-in date's getUTCDay()).
 */
export function resolveLatePolicy(
  scheduleDays: ReadonlyArray<ScheduleDay> | null | undefined,
  scheduleGraceMin: number | null | undefined,
  dow: number,
  companyDefault: LatePolicy,
): LatePolicy | null {
  if (scheduleDays && scheduleDays.length > 0) {
    const todayDay = scheduleDays.find((d) => d.dayOfWeek === dow);
    if (!todayDay) return null; // off-schedule day → not late
    return { startTime: todayDay.startTime, graceMin: scheduleGraceMin ?? companyDefault.graceMin };
  }
  return companyDefault;
}

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

/** A half-open [startMin, endMin) window in minutes-of-day (Asia/Bangkok). */
export type MinuteWindow = { startMin: number; endMin: number };

/**
 * Where lateness should start counting from, once approved leave and the
 * lunch break are taken into account. Begins at the scheduled start and:
 *
 *  - advances past any leave window that COVERS the current start (so a
 *    morning-half leave 09:00–12:00 pushes 09:00 → 12:00; a leave that begins
 *    AFTER the start — e.g. an hourly 10:00–12:00 — does not, because the
 *    09:00–10:00 slice was still expected work);
 *  - advances past the lunch break when the start lands inside it (12:00 →
 *    13:00), so a check-in during lunch right after a morning leave is on time;
 *  - repeats, so a morning leave that lands in lunch and then meets a bridging
 *    afternoon-hour leave chains through all of them.
 *
 * Pure. `leaveWindows` / `breakWindow` are minutes-of-day; the caller converts
 * OnLeave rows and the LeaveConfig lunch gap with `bangkokMinutesOfDay`.
 */
export function effectiveLateStartMin(
  scheduledStartMin: number,
  leaveWindows: ReadonlyArray<MinuteWindow>,
  breakWindow: MinuteWindow | null,
): number {
  let eff = scheduledStartMin;
  // Bounded: each iteration consumes at least one window or the break, so
  // (#windows + 1) passes is a hard ceiling even on overlapping input.
  for (let i = 0; i <= leaveWindows.length + 1; i++) {
    const covering = leaveWindows.find((w) => w.startMin <= eff && eff < w.endMin);
    if (covering) {
      eff = covering.endMin;
      continue;
    }
    if (breakWindow && breakWindow.startMin <= eff && eff < breakWindow.endMin) {
      eff = breakWindow.endMin;
      continue;
    }
    break;
  }
  return eff;
}

/** Approved-leave / lunch context that shifts where lateness starts counting. */
export type LateContext = {
  /** Approved partial-leave windows for the day, as Bangkok minutes-of-day. */
  leaveWindows?: ReadonlyArray<MinuteWindow>;
  /** The lunch break (LeaveConfig morningEnd→afternoonStart), minutes-of-day. */
  breakWindow?: MinuteWindow | null;
  /** A full-day leave covers the whole day → there is no start to be late against. */
  fullDayLeave?: boolean;
};

/**
 * Minutes late for a check-in, measured from the (leave-adjusted) scheduled
 * start — but only once the lateness exceeds the grace window. Returns 0 when
 * on time or within grace.
 *
 * Example (start 09:00, grace 15): 09:14 → 0, 09:15 → 0, 09:16 → 16, 11:14 → 134.
 *
 * With `ctx`, an approved morning leave + lunch break move the reference point:
 * leave 09:00–12:00, lunch 12:00–13:00, check-in 12:16 → 0 (not 196).
 *
 * NOTE: this does NOT know about closed days (Sundays / holidays). The caller
 * decides whether the day is a working day before recording a Late row.
 */
export function lateMinutesForCheckIn(
  clockInAt: Date,
  policy: LatePolicy = DEFAULT_LATE_POLICY,
  ctx?: LateContext,
): number {
  if (ctx?.fullDayLeave) return 0;
  const start = hhmmToMinutes(policy.startTime);
  if (start == null) return 0;
  const effStart = effectiveLateStartMin(start, ctx?.leaveWindows ?? [], ctx?.breakWindow ?? null);
  const lateBy = bangkokMinutesOfDay(clockInAt) - effStart;
  return lateBy > policy.graceMin ? lateBy : 0;
}
