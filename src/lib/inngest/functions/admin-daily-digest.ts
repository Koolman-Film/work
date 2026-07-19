/**
 * Daily 09:30 digest of what is waiting for each admin.
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
import { loadPendingCounts } from '@/lib/notifications/pending-counts';
import { inngest } from '../client';
import { sendNotification } from '../events';

/** Pure send/skip decision — kept separate from I/O so it's testable under
 *  Vitest's node environment without touching Prisma or Inngest. */
export function shouldSendDigest(c: {
  leave: number;
  advance: number;
  attendance: number;
}): boolean {
  return c.leave + c.advance + c.attendance > 0;
}

export const adminDailyDigest = inngest.createFunction(
  {
    id: 'admin-daily-digest',
    retries: 2,
    triggers: [{ cron: 'TZ=Asia/Bangkok 30 9 * * *' }],
  },
  async ({ step, logger }) => {
    const adminIds = await step.run('list-admins', () => linePushAdminIds());

    if (adminIds.length === 0) {
      logger.info('admin-daily-digest: no LINE-linked admins, nothing to do');
      return { notified: 0, admins: 0 };
    }

    let notified = 0;
    for (const adminId of adminIds) {
      const counts = await step.run(`pending-counts-${adminId}`, async () => {
        const assignments = await getUserAssignments(adminId);
        return loadPendingCounts(assignments);
      });

      if (!shouldSendDigest(counts)) continue;

      await step.run(`send-${adminId}`, () =>
        sendNotification(adminId, { kind: 'admin.daily-digest', ...counts }),
      );
      notified++;
    }

    return { notified, admins: adminIds.length };
  },
);
