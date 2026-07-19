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

/**
 * Admins who can receive LINE pushes: archived-free, LINE-linked, and
 * holding `liff.admin` (or Superadmin). Shared with the daily digest cron
 * (`admin-daily-digest.ts`) so the two can never target different people —
 * do NOT copy this `where` clause anywhere else.
 */
export async function linePushAdminIds(): Promise<string[]> {
  const recipients = await prisma.user.findMany({
    where: {
      archivedAt: null,
      lineUserId: { not: null },
      roleAssignments: {
        some: {
          // Target liff.admin holders (not just role.key === 'admin'):
          // the push deep-links into /liff/admin/* pages, which 404 for
          // anyone without that permission — a custom admin role that
          // lacks liff.admin must not receive dead-end pushes, and a
          // custom role that HAS it should. Superadmin short-circuits.
          role: {
            archivedAt: null,
            OR: [{ isSuperadmin: true }, { permissions: { has: 'liff.admin' } }],
          },
        },
      },
    },
    select: { id: true },
  });
  return recipients.map((r) => r.id);
}

export async function notifyAdminsOnLine(payload: AdminLinePayload): Promise<void> {
  try {
    const recipientIds = await linePushAdminIds();
    const results = await Promise.allSettled(
      recipientIds.map((id) => sendNotification(id, payload)),
    );
    for (const r of results) {
      if (r.status === 'rejected') {
        console.error('[notifyAdminsOnLine] one recipient failed (non-fatal)', {
          kind: payload.kind,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
      }
    }
  } catch (err) {
    console.error('[notifyAdminsOnLine] failed (non-fatal)', {
      kind: payload.kind,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
