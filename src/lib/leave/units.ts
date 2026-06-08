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

/** "HH:MM" → minutes since midnight. Assumes app-validated input. */
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
