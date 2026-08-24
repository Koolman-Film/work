/**
 * The one way to render an employee's name for humans: their nickname when
 * they have one, otherwise "First Last".
 *
 * Pure and free of `server-only` so it is unit-testable — the same reason
 * `inngest/functions/birthday-targets.ts` was split out of its cron.
 *
 * NOTE: this expression is currently duplicated at a dozen call sites across
 * crons, LIFF pages and admin pages, each with slightly different guards
 * (`?.trim() ||` vs `&& .trim().length > 0`). This is the shared home; new
 * callers belong here rather than adding a thirteenth copy.
 */
export type NameableEmployee = {
  firstName: string;
  lastName: string;
  nickname: string | null;
};

export function employeeDisplayName(e: NameableEmployee): string {
  return e.nickname?.trim() ? e.nickname.trim() : `${e.firstName} ${e.lastName}`.trim();
}
