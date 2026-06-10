/**
 * Leave time-unit helper — the single source of truth for converting
 * between minutes, the days+hours hybrid display, and the morning/afternoon
 * half-day windows. Pure (no DB, no time-of-day dependence).
 *
 * Convention: a "full leave day" = standardDayMinutes = morning + afternoon
 * window. Balances/quotas are accounted in standard days, decoupled from an
 * employee's actual shift length.
 */

export type LeaveUnitConfig = {
  morningStart: string; // "HH:MM"
  morningEnd: string;
  afternoonStart: string;
  afternoonEnd: string;
};

/**
 * "HH:MM" → minutes since midnight. Input MUST be a validated "HH:MM" string
 * (callers validate upstream — LeaveConfig columns + the leave-config action's
 * regex, and `<input type=time>`). Malformed input yields NaN by design; this
 * helper does not guard, to stay pure and cheap.
 */
export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

/** Minutes between two "HH:MM" times (end − start). */
export function windowMinutes(start: string, end: string): number {
  return minutesOf(end) - minutesOf(start);
}

export function morningMinutes(cfg: LeaveUnitConfig): number {
  return windowMinutes(cfg.morningStart, cfg.morningEnd);
}

export function afternoonMinutes(cfg: LeaveUnitConfig): number {
  return windowMinutes(cfg.afternoonStart, cfg.afternoonEnd);
}

/** A full leave day in minutes = morning window + afternoon window. */
export function standardDayMinutes(cfg: LeaveUnitConfig): number {
  return morningMinutes(cfg) + afternoonMinutes(cfg);
}

/**
 * Render minutes as the Thai days+hours+minutes hybrid, using the standard
 * day as the "day" size. Examples (420/day): 600 → "1 วัน 3 ชม.".
 *
 * @param minutes Non-negative integer count of minutes.
 */
export function formatDaysHours(minutes: number, cfg: LeaveUnitConfig): string {
  const perDay = standardDayMinutes(cfg);
  const days = Math.floor(minutes / perDay);
  const rem = minutes - days * perDay;
  const hours = Math.floor(rem / 60);
  const mins = rem - hours * 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days} วัน`);
  if (hours > 0) parts.push(`${hours} ชม.`);
  if (mins > 0) parts.push(`${mins} น.`);
  if (parts.length === 0) return '0 ชม.';
  return parts.join(' ');
}

export type LeaveUnit = 'FullDay' | 'HalfMorning' | 'HalfAfternoon' | 'Hourly';

export type LeaveSegment = {
  startTime: string | null; // null for FullDay
  endTime: string | null;
  minutes: number; // per-day minutes this unit charges
};

/**
 * Resolve a leave unit to a concrete time segment + per-day minutes.
 * Halves use the config windows; Hourly uses caller times (must be a valid
 * start < end); FullDay has null times and one standard day of minutes.
 * Returns null when the inputs are invalid (e.g. hourly with end ≤ start).
 */
export function segmentFor(
  unit: LeaveUnit,
  cfg: LeaveUnitConfig,
  startTime?: string | null,
  endTime?: string | null,
): LeaveSegment | null {
  switch (unit) {
    case 'FullDay':
      return { startTime: null, endTime: null, minutes: standardDayMinutes(cfg) };
    case 'HalfMorning':
      return { startTime: cfg.morningStart, endTime: cfg.morningEnd, minutes: morningMinutes(cfg) };
    case 'HalfAfternoon':
      return {
        startTime: cfg.afternoonStart,
        endTime: cfg.afternoonEnd,
        minutes: afternoonMinutes(cfg),
      };
    case 'Hourly': {
      if (!startTime || !endTime) return null;
      const mins = windowMinutes(startTime, endTime);
      if (mins <= 0) return null;
      return { startTime, endTime, minutes: mins };
    }
  }
}

/**
 * Human label for what a leave request will actually charge, matching the
 * worker-side estimate and the approval notification: FullDay multi-day →
 * "3 วัน", half-afternoon → "5 ชม.", hourly → "2 ชม. 30 น.". Partial units
 * occupy a single date, so workingDays is 0 or 1 for them. Falls back to the
 * plain working-day count when the stored times are invalid.
 */
export function leaveDurationLabel(
  unit: LeaveUnit,
  workingDays: number,
  cfg: LeaveUnitConfig,
  startTime?: string | null,
  endTime?: string | null,
): string {
  const seg = segmentFor(unit, cfg, startTime, endTime);
  if (!seg) return `${workingDays} วัน`;
  return formatDaysHours(seg.minutes * workingDays, cfg);
}

/**
 * Half-open [start, end) overlap test for two same-date segments. A null
 * start/end means "whole day", which overlaps everything.
 */
export function segmentsOverlap(
  aStart: string | null,
  aEnd: string | null,
  bStart: string | null,
  bEnd: string | null,
): boolean {
  if (aStart == null || aEnd == null || bStart == null || bEnd == null) return true;
  return minutesOf(aStart) < minutesOf(bEnd) && minutesOf(bStart) < minutesOf(aEnd);
}
