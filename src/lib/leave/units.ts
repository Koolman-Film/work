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

/** Minutes split into days+hours+minutes, using the standard day as the "day" size. */
export type DurationParts = { days: number; hours: number; mins: number };

/**
 * Split minutes into the days+hours+minutes hybrid, using the standard
 * day as the "day" size. Examples (420/day): 600 → {days:1, hours:3, mins:0}.
 *
 * @param minutes Non-negative integer count of minutes.
 */
export function splitDaysHours(minutes: number, cfg: LeaveUnitConfig): DurationParts {
  const perDay = standardDayMinutes(cfg);
  const days = Math.floor(minutes / perDay);
  const rem = minutes - days * perDay;
  const hours = Math.floor(rem / 60);
  const mins = rem - hours * 60;
  return { days, hours, mins };
}

/** Per-unit label renderers, e.g. {day: n => `${n} days`}. Lets callers plug
 *  in next-intl `t('day', {n})` so the units follow the viewer's locale. */
export type DurationUnitLabels = {
  day: (n: number) => string;
  hour: (n: number) => string;
  min: (n: number) => string;
};

/** Render duration parts with caller-supplied unit labels ("1 วัน 3 ชม." / "1 day 3 hr"). */
export function formatDurationParts(parts: DurationParts, labels: DurationUnitLabels): string {
  const out: string[] = [];
  if (parts.days > 0) out.push(labels.day(parts.days));
  if (parts.hours > 0) out.push(labels.hour(parts.hours));
  if (parts.mins > 0) out.push(labels.min(parts.mins));
  if (out.length === 0) return labels.hour(0);
  return out.join(' ');
}

const THAI_UNIT_LABELS: DurationUnitLabels = {
  day: (n) => `${n} วัน`,
  hour: (n) => `${n} ชม.`,
  min: (n) => `${n} น.`,
};

/**
 * Render minutes as the Thai days+hours+minutes hybrid, using the standard
 * day as the "day" size. Examples (420/day): 600 → "1 วัน 3 ชม.".
 *
 * Thai-only — for the admin UI, which is intentionally untranslated.
 * Worker-facing surfaces use splitDaysHours + formatDurationParts with
 * locale-aware labels instead.
 *
 * @param minutes Non-negative integer count of minutes.
 */
export function formatDaysHours(minutes: number, cfg: LeaveUnitConfig): string {
  return formatDurationParts(splitDaysHours(minutes, cfg), THAI_UNIT_LABELS);
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
