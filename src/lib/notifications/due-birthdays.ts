import 'server-only';

import { prisma } from '@/lib/db/prisma';
import { employeeDisplayName } from '@/lib/employee/display-name';
import type { BirthdayTargets } from '@/lib/inngest/functions/birthday-targets';

export type DueBirthday = { id: string; displayName: string; daysUntil: 0 | 1 };

type DueRow = {
  id: string;
  firstName: string;
  lastName: string;
  nickname: string | null;
  daysUntil: number;
};

/**
 * Employees whose birthday is today or tomorrow in the Bangkok calendar.
 *
 * Raw SQL because a birthday recurs every year: the match is on month/day,
 * which Prisma's query API cannot express. Feb-29 birthdays only fire in leap
 * years — accepted V1 behaviour, unchanged from the original cron.
 *
 * Takes `BirthdayTargets` rather than a Date ON PURPOSE. Both callers are
 * Inngest crons, and `birthday-reminder` deliberately memoizes the targets in
 * their own `step.run('compute-targets')` so a replay crossing midnight reuses
 * the same today/tomorrow values instead of drifting and mismatching its
 * per-employee step keys. Computing `new Date()` in here would defeat that.
 * Callers own the memoization; this stays a pure read.
 *
 * Shared by `birthday-reminder` (in-app bell) and `admin-daily-digest` (LINE
 * line item) so the two can never disagree about who has a birthday.
 */
export async function dueBirthdays(t: BirthdayTargets): Promise<DueBirthday[]> {
  const rows = await prisma.$queryRaw<DueRow[]>`
    SELECT id, "firstName", "lastName", nickname,
      CASE
        WHEN EXTRACT(MONTH FROM "dateOfBirth") = ${t.todMonth}
         AND EXTRACT(DAY   FROM "dateOfBirth") = ${t.todDay}
        THEN 0 ELSE 1
      END AS "daysUntil"
    FROM "Employee"
    WHERE "archivedAt" IS NULL
      AND status::text <> 'Archived'
      AND "dateOfBirth" IS NOT NULL
      AND (
        (EXTRACT(MONTH FROM "dateOfBirth") = ${t.todMonth} AND EXTRACT(DAY FROM "dateOfBirth") = ${t.todDay})
        OR
        (EXTRACT(MONTH FROM "dateOfBirth") = ${t.tomMonth} AND EXTRACT(DAY FROM "dateOfBirth") = ${t.tomDay})
      )`;
  return rows.map((r) => ({
    id: r.id,
    displayName: employeeDisplayName(r),
    daysUntil: Number(r.daysUntil) === 0 ? 0 : 1,
  }));
}
