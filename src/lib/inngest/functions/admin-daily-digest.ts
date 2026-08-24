/**
 * Daily 08:30 digest of what is waiting for each admin.
 *
 * Replaces the per-event LINE fan-out, which cost one message per admin per
 * request and was 65% of July's 464-message spend against a 300/month cap
 * (every leave request, advance request, and check-in dispute pushed once
 * per admin — with 3 admins linked that's ~3 messages per event).
 *
 * Reports STATE, not events: it asks what is pending right now rather than
 * replaying yesterday's activity. That needs no stored state between runs,
 * is always accurate, and never re-reports work an admin already cleared
 * overnight — do not turn this into an event accumulator.
 *
 * Recipients are exactly `linePushAdminIds()` (admin-line.ts) — the same
 * predicate the per-event pushes use, so the digest can never target a
 * different set of people than the pushes did. Counts are
 * `loadPendingCounts()` (pending-counts.ts), the same branch-scoped query
 * that backs the sidebar badges — so the digest and the badges can never
 * disagree either.
 *
 * Silent admins (nothing pending) cost zero messages — `shouldSendDigest`
 * gates the send per admin.
 */

import { getUserAssignments } from '@/lib/auth/check-permission';
import { linePushAdminIds } from '@/lib/notifications/admin-line';
import { dueBirthdays } from '@/lib/notifications/due-birthdays';
import { loadPendingCounts } from '@/lib/notifications/pending-counts';
import { inngest } from '../client';
import { sendNotification } from '../events';
import { birthdayTargets } from './birthday-targets';

/** Pure send/skip decision — kept separate from I/O so it's testable under
 *  Vitest's node environment without touching Prisma or Inngest.
 *
 *  `birthdays` is REQUIRED, not optional-with-default. This predicate is the
 *  only thing standing between the digest and the 300/month LINE cap, and an
 *  optional field lets a call site be missed. A missed call site here fails
 *  SILENTLY — it simply stops sending birthday reminders on quiet days, which
 *  is the exact behaviour the field exists to provide. Required turns that
 *  into a compile error instead. */
export function shouldSendDigest(c: {
  leave: number;
  advance: number;
  attendance: number;
  birthdays: number;
}): boolean {
  return c.leave + c.advance + c.attendance + c.birthdays > 0;
}

export const adminDailyDigest = inngest.createFunction(
  {
    id: 'admin-daily-digest',
    retries: 2,
    // 08:30 Bangkok, chosen from the audit log rather than guessed.
    //
    // The number that settles it is when an admin takes their FIRST action
    // of the day, not which hour is busiest. Across 104 admin-days: only 5
    // (4.8%) begin before 08:00, and the mode sits at 08:41–08:59. So the
    // digest wants to land just ahead of ~08:40, not at dawn.
    //
    // Two earlier drafts were worse for opposite reasons. 09:30 landed
    // mid-sweep and reported work already cleared. 07:30 would arrive over
    // an hour before almost anyone starts — and because this digest reports
    // pending state AT SEND TIME, sending early only makes the numbers
    // staler by the time they are read, while missing the 29 requests that
    // arrive during the 08:00 hour. Later is better right up until it stops
    // being early enough.
    triggers: [{ cron: 'TZ=Asia/Bangkok 30 8 * * *' }],
  },
  async ({ step, logger }) => {
    const adminIds = await step.run('list-admins', () => linePushAdminIds());

    if (adminIds.length === 0) {
      logger.info('admin-daily-digest: no LINE-linked admins, nothing to do');
      return { notified: 0, admins: 0 };
    }

    // Fetched ONCE, outside the per-admin loop: a birthday is company-wide, so
    // unlike the pending counts there is nothing branch-scoped to recompute per
    // admin. Targets are memoized in their own step for the same replay-safety
    // reason birthday-reminder does it — see due-birthdays.ts.
    const targets = await step.run('compute-targets', () => birthdayTargets(new Date()));
    const birthdays = await step.run('due-birthdays', async () =>
      (await dueBirthdays(targets)).map((b) => b.displayName),
    );

    let notified = 0;
    for (const adminId of adminIds) {
      const counts = await step.run(`pending-counts-${adminId}`, async () => {
        const assignments = await getUserAssignments(adminId);
        return loadPendingCounts(assignments);
      });

      if (!shouldSendDigest({ ...counts, birthdays: birthdays.length })) continue;

      await step.run(`send-${adminId}`, () =>
        sendNotification(adminId, { kind: 'admin.daily-digest', ...counts, birthdays }),
      );
      notified++;
    }

    return { notified, admins: adminIds.length };
  },
);
