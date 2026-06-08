/**
 * Pure helper for birthday-reminder: given "now", return the month/day of
 * today and tomorrow in the Bangkok calendar (UTC+7, no DST). Kept
 * separate from the cron so it has no server-only deps and is unit
 * testable. Real date arithmetic handles month/year rollover.
 */

export type BirthdayTargets = {
  todMonth: number; // 1-12
  todDay: number; // 1-31
  tomMonth: number;
  tomDay: number;
};

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

export function birthdayTargets(now: Date): BirthdayTargets {
  const bkkToday = new Date(now.getTime() + BANGKOK_OFFSET_MS);
  const bkkTomorrow = new Date(bkkToday.getTime() + 24 * 60 * 60 * 1000);
  return {
    todMonth: bkkToday.getUTCMonth() + 1,
    todDay: bkkToday.getUTCDate(),
    tomMonth: bkkTomorrow.getUTCMonth() + 1,
    tomDay: bkkTomorrow.getUTCDate(),
  };
}
