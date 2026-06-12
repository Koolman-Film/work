'use server';

/**
 * LINE-push fan-out to paired admins — the LINE sibling of
 * notifyAdminsInApp (same recipient predicate + lineUserId required).
 * Fire-and-forget: failures log, never propagate to the worker's submit.
 */

import { prisma } from '@/lib/db/prisma';
import { type NotificationPayload, sendNotification } from '@/lib/inngest/events';

type AdminLinePayload = Extract<
  NotificationPayload,
  { kind: 'admin.leave-submitted' | 'admin.advance-submitted' | 'admin.dispute-submitted' }
>;

export async function notifyAdminsOnLine(payload: AdminLinePayload): Promise<void> {
  try {
    const recipients = await prisma.user.findMany({
      where: {
        archivedAt: null,
        lineUserId: { not: null },
        roleAssignments: {
          some: {
            role: { archivedAt: null, OR: [{ isSuperadmin: true }, { key: 'admin' }] },
          },
        },
      },
      select: { id: true },
    });
    await Promise.all(recipients.map((r) => sendNotification(r.id, payload)));
  } catch (err) {
    console.error('[notifyAdminsOnLine] failed (non-fatal)', {
      kind: payload.kind,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
