/**
 * `line-push-notification` — the Inngest function that delivers
 * `notification.send` events as LINE Flex Messages.
 *
 * Pipeline (each step is a separate Inngest `step.run` so retries are
 * idempotent at each stage; if step 3 fails, steps 1+2 don't re-run):
 *
 *   1. Insert Notification row (channel=LineMessage, sentAt=null)
 *   2. Look up recipient's User.lineUserId via Prisma
 *   3. If no lineUserId → mark notification as "skipped" and return.
 *      Don't retry — the binding will only appear after the employee
 *      completes /liff/pair, which is asynchronous.
 *   4. Build Flex Message from the event payload (kind-discriminated)
 *   5. POST to LINE Messaging /v2/bot/message/push
 *   6. On success → set Notification.sentAt = now()
 *   7. On failure → throw; Inngest auto-retries up to `retries: 3`
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
import { inngest } from '../client';
import type { NotificationSendEvent } from '../events';

type FlexMessage = messagingApi.FlexMessage;

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

    // Step 1 — durable Notification row
    const notification = await step.run('insert-notification-row', async () => {
      return await prisma.notification.create({
        data: {
          userId: recipientUserId,
          channel: 'LineMessage',
          event: payload.kind,
          payload,
        },
        select: { id: true },
      });
    });

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
