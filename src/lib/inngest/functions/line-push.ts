/**
 * `line-push-notification` — the Inngest function that delivers
 * `notification.send` events as LINE Flex Messages.
 *
 * Pipeline (each step is a separate Inngest `step.run` so retries are
 * idempotent at each stage; if step 3 fails, steps 1+2 don't re-run):
 *
 *   1. Insert Notification row (channel=LineMessage, sentAt=null). Skips
 *      entirely if the recipient User no longer exists — userId is a FK, and
 *      a queued push can outlive its User.
 *   2. Look up recipient's User.lineUserId via Prisma
 *   3. If no lineUserId → mark notification as "skipped" and return.
 *      Don't retry — the binding will only appear after the employee
 *      completes /liff/pair, which is asynchronous.
 *   4. Build Flex Message from the event payload (kind-discriminated)
 *   5. Check LINE monthly quota headroom (src/lib/line/quota.ts). If
 *      exhausted → mark "skipped" (at most one admin bell/day) and return.
 *      Not a failure — do NOT throw, or Inngest retries a send we
 *      deliberately declined.
 *   6. POST to LINE Messaging /v2/bot/message/push
 *   7. On success → set Notification.sentAt = now()
 *   8. On failure → throw; Inngest auto-retries up to `retries: 3`
 *
 * Idempotency:
 *   - `Notification.create` step is dedup'd by Inngest's step memoization
 *     (each step.run output is cached on a specific run; replay returns
 *     the cached result instead of re-creating).
 *   - Event-level dedup happens at `inngest.send(id: ...)` time —
 *     same payload firing twice within 24h is collapsed to one run.
 */

import type { messagingApi } from '@line/bot-sdk';
import { prisma } from '@/lib/db/prisma';
import { DEFAULT_LOCALE, isLocale } from '@/lib/i18n/config';
import { appBaseUrl, buildFlexMessage } from '@/lib/line/flex-templates';
import { getLineMessagingClient } from '@/lib/line/messaging-client';
import { hasQuotaHeadroom } from '@/lib/line/quota';
import { notifyAdminsInApp } from '@/lib/notifications/in-app-bell';
import { inngest } from '../client';
import type { NotificationSendEvent } from '../events';

type FlexMessage = messagingApi.FlexMessage;

/** Start of "today" in Asia/Bangkok, as a UTC instant — used to check
 *  whether we've already pinged the bell about the quota today. */
function bangkokTodayStart(): Date {
  const ymd = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  return new Date(`${ymd}T00:00:00+07:00`);
}

/** Whether an admin bell for the quota-exhausted event has already fired
 *  today. Keeps a whole day of skipped pushes to a single bell ping instead
 *  of one per message. */
async function alreadyNotifiedQuotaLowToday(): Promise<boolean> {
  const existing = await prisma.notification.findFirst({
    where: {
      channel: 'InAppBell',
      event: 'system.line-quota-low',
      createdAt: { gte: bangkokTodayStart() },
    },
    select: { id: true },
  });
  return existing != null;
}

/**
 * Create the durable Notification row, or report that the recipient is gone.
 *
 * Notification.userId is a FK, so a recipient who has been DELETED (not
 * archived) makes the create throw P2003. That was firing continuously in
 * production — 96 occurrences across 9 users — because the caller's graceful
 * handling for missing recipients sat one step BEHIND this write. A queued
 * notification outliving its User is normal: events are fired, then a User is
 * deleted before the job drains.
 *
 * Returns null instead of throwing so the caller can skip rather than burn its
 * retries on a state that will never resolve.
 *
 * The check-then-insert race (deleted in between) is left deliberately
 * unguarded: it is self-healing, because the retry re-runs this and takes the
 * null path. A transaction would buy nothing an FK doesn't already enforce.
 *
 * Exported for tests/integration/line-push-missing-user.integration.test.ts —
 * this only means anything against a database that actually has the FK.
 */
export async function insertNotificationRow(
  recipientUserId: string,
  payload: Omit<NotificationSendEvent['data'], 'recipientUserId'>,
): Promise<{ id: string } | null> {
  const recipientExists = await prisma.user.findUnique({
    where: { id: recipientUserId },
    select: { id: true },
  });
  if (!recipientExists) return null;

  return await prisma.notification.create({
    data: {
      userId: recipientUserId,
      channel: 'LineMessage',
      event: payload.kind,
      payload,
    },
    select: { id: true },
  });
}

export const linePushNotification = inngest.createFunction(
  {
    id: 'line-push-notification',
    retries: 3,
    // v4 places trigger(s) inside the options object — not a separate
    // positional arg like the v3 API.
    triggers: [{ event: 'notification.send' }],
  },
  async ({ event, step, logger }) => {
    // Inngest's v4 type machinery doesn't carry the schema through to
    // event.data automatically (we dropped EventSchemas to keep the
    // client decoupled from SDK type internals). Assert the shape here;
    // sendNotification() is the only thing that fires this event, and
    // its signature enforces the type at the call site.
    const data = event.data as NotificationSendEvent['data'];
    const { recipientUserId, ...payload } = data;

    // Step 1 — durable Notification row.
    //
    // Guarded inside this step rather than by resolving the recipient first:
    // Inngest memoizes by step ID, so reordering the steps would break replay
    // for runs already in flight. See insertNotificationRow.
    const notification = await step.run('insert-notification-row', () =>
      insertNotificationRow(recipientUserId, payload),
    );

    // Nothing to deliver and nothing to record — the recipient is gone.
    // A skip, not a failure: throwing would burn all 3 retries and surface
    // as an Inngest function error for a state that will never resolve.
    if (!notification) {
      logger.info(`skipping push: User.${recipientUserId} no longer exists`);
      return { notificationId: null, delivered: false, reason: 'user-deleted' };
    }

    // Step 2 — look up LINE userId + recipient locale
    const userInfo = await step.run('lookup-line-user-id', async () => {
      const u = await prisma.user.findUnique({
        where: { id: recipientUserId },
        select: { lineUserId: true, archivedAt: true, locale: true },
      });
      // Archived users don't get notifications. Refusing here also
      // prevents leaking that an archived account still exists.
      if (!u || u.archivedAt) return null;
      return { lineUserId: u.lineUserId, locale: u.locale };
    });
    const lineUserId = userInfo?.lineUserId ?? null;

    // Step 3 — bail if not paired. Not a failure; just no delivery channel.
    if (!userInfo || !lineUserId) {
      logger.info(
        `skipping push: no lineUserId on User.${recipientUserId} (employee not yet paired)`,
      );
      return {
        notificationId: notification.id,
        delivered: false,
        reason: 'no-line-user-id',
      };
    }

    // Step 4 — build the Flex Message (pure; outside step.run because
    // it's not I/O and replay-deterministic).
    // Resolve recipient locale: prefer the stored value, fall back to DEFAULT_LOCALE.
    const recipientLocale = isLocale(userInfo.locale) ? userInfo.locale : DEFAULT_LOCALE;
    const message: FlexMessage = buildFlexMessage(payload, appBaseUrl(), recipientLocale);

    // Quota gate. Skipping is a normal outcome, not a failure — do NOT throw,
    // or Inngest will retry a send we deliberately declined.
    const hasRoom = await step.run('check-quota', () => hasQuotaHeadroom());
    if (!hasRoom) {
      logger.warn(`skipping push: LINE quota headroom exhausted (notification ${notification.id})`);
      await step.run('mark-quota-skipped', async () => {
        // Merge a marker into the row's payload so a quota-skipped
        // notification is distinguishable from a still-queued one in the
        // table — the 464-message July figure that justified this whole
        // branch was measured from this table, and a skipped row that
        // looks "sent" would quietly inflate future counts.
        await prisma.notification.update({
          where: { id: notification.id },
          data: { payload: { ...payload, skipped: 'quota' } },
        });
        // At most one bell/day — a whole day of skipped pushes shouldn't
        // spam the bell once per declined message.
        if (await alreadyNotifiedQuotaLowToday()) return;
        await notifyAdminsInApp({
          kind: 'system.line-quota-low',
          notificationId: notification.id,
        });
      });
      return { notificationId: notification.id, delivered: false, reason: 'quota-exhausted' };
    }

    // Step 5 — push to LINE.
    // If this throws, Inngest retries with exponential backoff (3 retries
    // per the function config). The push API itself is idempotent at the
    // Inngest step level — re-runs of this step will issue another push,
    // which IS technically a duplicate from LINE's perspective. To make
    // push idempotent end-to-end we'd need to track the LINE response's
    // request-id and skip on duplicate — Phase-1 acceptable risk.
    await step.run('push-to-line', async () => {
      const client = getLineMessagingClient();
      await client.pushMessage({ to: lineUserId, messages: [message] });
    });

    // Step 6 — mark sent
    await step.run('mark-notification-sent', async () => {
      await prisma.notification.update({
        where: { id: notification.id },
        data: { sentAt: new Date() },
      });
    });

    return { notificationId: notification.id, delivered: true };
  },
);
