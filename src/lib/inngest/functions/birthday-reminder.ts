/**
 * `birthday-reminder` — daily cron that posts an in-app bell to admins for
 * each employee whose birthday is today or tomorrow.
 *
 * When: 09:00 Bangkok (= 02:00 UTC), same slot as probation-reminder.
 *
 * The query itself lives in `@/lib/notifications/due-birthdays` because the
 * 08:30 admin digest needs the same rows — one query, two callers, so the bell
 * and the LINE digest can never disagree about whose birthday it is.
 */

import { dueBirthdays } from '@/lib/notifications/due-birthdays';
import { notifyAdminsInApp } from '@/lib/notifications/in-app-bell';
import { inngest } from '../client';
import { birthdayTargets } from './birthday-targets';

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

    // Targets are PASSED IN rather than recomputed inside dueBirthdays —
    // that is what keeps the memoization above load-bearing.
    //
    // Step id is 'find-due-shared', NOT the previous 'find-due': this step's
    // RETURN SHAPE changed on 2026-08-24 (raw rows → DueBirthday with a
    // resolved displayName). Inngest memoizes step output per run, so a run
    // in flight across the deploy would replay and hand the new destructuring
    // an old-shaped row — undefined displayName, and a string "0" daysUntil
    // that fails `=== 0` and mislabels today's birthday as tomorrow's. A new
    // id has no memo to reuse, so the replay simply re-runs the query.
    const due = await step.run('find-due-shared', () =>
      dueBirthdays({ todMonth, todDay, tomMonth, tomDay }),
    );

    if (due.length === 0) {
      return { notified: 0 };
    }

    for (const emp of due) {
      const { displayName, daysUntil } = emp;
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
