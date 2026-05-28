'use server';

/**
 * Server actions for the in-app bell UI (read by the Topbar's
 * NotificationBell Client Component).
 *
 *   - `fetchRecentNotifications()` — pull the last N for current user,
 *     newest first. Returns lightweight shape suitable for client
 *     state (no Prisma types leak).
 *   - `markAllNotificationsRead()` — flip readAt on all the current
 *     user's unread notifications. Idempotent.
 *   - `markOneNotificationRead(id)` — flip readAt on a single row.
 *     Defends against marking someone else's notification by
 *     filtering on userId in the update where clause.
 */

import { requireRole } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';

export type BellNotification = {
  id: string;
  event: string;
  /** Free-form JSON shape — the client decodes per-kind to render. */
  payload: unknown;
  readAt: string | null;
  createdAt: string;
};

const RECENT_LIMIT = 20;

export async function fetchRecentNotifications(): Promise<BellNotification[]> {
  const { user } = await requireRole(['Admin', 'Superadmin']);

  const rows = await prisma.notification.findMany({
    where: {
      userId: user.id,
      channel: 'InAppBell',
    },
    orderBy: { createdAt: 'desc' },
    take: RECENT_LIMIT,
    select: {
      id: true,
      event: true,
      payload: true,
      readAt: true,
      createdAt: true,
    },
  });

  return rows.map((r) => ({
    id: r.id,
    event: r.event,
    payload: r.payload,
    readAt: r.readAt ? r.readAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function markAllNotificationsRead(): Promise<{ updated: number }> {
  const { user } = await requireRole(['Admin', 'Superadmin']);

  const result = await prisma.notification.updateMany({
    where: {
      userId: user.id,
      channel: 'InAppBell',
      readAt: null,
    },
    data: { readAt: new Date() },
  });
  return { updated: result.count };
}

export async function markOneNotificationRead(notificationId: string): Promise<{ ok: boolean }> {
  const { user } = await requireRole(['Admin', 'Superadmin']);

  // The userId filter is the security gate — without it, an admin
  // could mark someone else's notifications as read. updateMany
  // returns count=0 silently if the row doesn't exist OR doesn't
  // belong to the caller, which is exactly the behavior we want.
  const result = await prisma.notification.updateMany({
    where: {
      id: notificationId,
      userId: user.id,
      channel: 'InAppBell',
    },
    data: { readAt: new Date() },
  });
  return { ok: result.count > 0 };
}
