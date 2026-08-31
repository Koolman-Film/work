/**
 * The one way to render an employee's name for humans: their nickname when
 * they have one, otherwise "First Last".
 *
 * Pure and free of `server-only` so it is unit-testable — the same reason
 * `inngest/functions/birthday-targets.ts` was split out of its cron.
 *
 * Five byte-identical call sites now use this. FOUR REMAIN, deliberately, and
 * each differs in a way a blanket replacement would have changed:
 *
 *   attendance/check-in.ts, advance/admin.ts, advance/actions.ts, and
 *   reports/queries.ts return the nickname UNTRIMMED
 *     (`if (n && n.trim().length > 0) return n`). This helper returns it
 *     trimmed. Trimming is almost certainly the better behaviour, but those
 *     paths feed LINE notifications and reports, so changing what they render
 *     is a behaviour change and does not belong inside a dedup commit.
 *
 *   settings/team/member-label.ts builds "nickname · full name" — different
 *     semantics, not a duplicate.
 *
 *   inngest/functions/attendance-late-check.ts falls back to firstName ALONE,
 *     deliberately, for a compact notification list.
 *
 * New callers belong here.
 */
export type NameableEmployee = {
  firstName: string;
  lastName: string;
  nickname: string | null;
};

export function employeeDisplayName(e: NameableEmployee): string {
  return e.nickname?.trim() ? e.nickname.trim() : `${e.firstName} ${e.lastName}`.trim();
}
