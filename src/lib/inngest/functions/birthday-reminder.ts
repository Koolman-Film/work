/**
 * `birthday-reminder` — daily cron that posts an in-app bell to admins for
 * each employee whose birthday is today or tomorrow.
 *
 * When: 09:00 Bangkok (= 02:00 UTC), same slot as probation-reminder.
 *
 * Why month/day raw SQL: a birthday recurs every year, so we match on
 * EXTRACT(MONTH/DAY) ignoring the year — which Prisma's typed date API
 * can't express. Feb-29 birthdays only fire in leap years (accepted V1
 * limitation).
 */

import { prisma } from '@/lib/db/prisma';
import { notifyAdminsInApp } from '@/lib/notifications/in-app-bell';
import { inngest } from '../client';
import { birthdayTargets } from './birthday-targets';

type DueRow = {
  id: string;
  firstName: string;
  lastName: string;
  nickname: string | null;
  daysUntil: number; // 0 today, 1 tomorrow (may arrive as a numeric string)
};

export const birthdayReminder = inngest.createFunction(
  {
    id: 'birthday-reminder',
    triggers: [{ cron: 'TZ=Asia/Bangkok 0 9 * * *' }],
  },
  async ({ step }) => {
    // Memoize the date targets in a step so retries/replays reuse the same
    // today/tomorrow values (new Date() would otherwise drift across a
    // midnight-crossing replay and mismatch the per-employee step keys).
    const { todMonth, todDay, tomMonth, tomDay } = await step.run('compute-targets', () =>
      birthdayTargets(new Date()),
    );

    const due = await step.run('find-due', async () => {
      return prisma.$queryRaw<DueRow[]>`
        SELECT id, "firstName", "lastName", nickname,
          CASE
            WHEN EXTRACT(MONTH FROM "dateOfBirth") = ${todMonth}
             AND EXTRACT(DAY   FROM "dateOfBirth") = ${todDay}
            THEN 0 ELSE 1
          END AS "daysUntil"
        FROM "Employee"
        WHERE "archivedAt" IS NULL
          AND status::text <> 'Archived'
          AND "dateOfBirth" IS NOT NULL
          AND (
            (EXTRACT(MONTH FROM "dateOfBirth") = ${todMonth} AND EXTRACT(DAY FROM "dateOfBirth") = ${todDay})
            OR
            (EXTRACT(MONTH FROM "dateOfBirth") = ${tomMonth} AND EXTRACT(DAY FROM "dateOfBirth") = ${tomDay})
          )`;
    });

    if (due.length === 0) {
      return { notified: 0 };
    }

    for (const emp of due) {
      const displayName = emp.nickname?.trim() || `${emp.firstName} ${emp.lastName}`.trim();
      const daysUntil = Number(emp.daysUntil) === 0 ? 0 : 1;
      const month = daysUntil === 0 ? todMonth : tomMonth;
      const day = daysUntil === 0 ? todDay : tomDay;
      const birthday = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      await step.run(`notify-${emp.id}-${daysUntil}`, async () => {
        await notifyAdminsInApp({
          kind: 'birthday.upcoming',
          employeeId: emp.id,
          employeeName: displayName,
          birthday,
          daysUntil,
        });
      });
    }

    return { notified: due.length, employeeIds: due.map((e) => e.id) };
  },
);
