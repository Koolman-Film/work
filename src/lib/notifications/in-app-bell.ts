'use server';

/**
 * In-app bell notifications for Admin/Owner.
 *
 * Different code path from LINE push:
 *   - LineMessage: Inngest function reads Notification row → pushes to
 *     LINE → marks sentAt. Durable retry. Employee recipient.
 *   - InAppBell:  this file. Inserts Notification rows directly. Admin
 *     browser subscribes to Realtime on the Notification table; the
 *     insert auto-pushes to all open admin sessions. No Inngest hop.
 *
 * Fan-out at insert time: when an employee submits something, we
 * insert ONE Notification row PER active Admin/Owner. Cheaper to
 * denormalize than to maintain a junction table — at Phase-1 scale
 * (≤5 admins), this is at most 5 rows per event.
 *
 * Why fire-and-forget rather than blocking the caller: in-app bells
 * are decoration. If the insert fails, the original action (employee
 * submitting leave) should still succeed. We log and move on; the
 * employee's submission doesn't get penalized for a notification
 * write hiccup.
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

export type AdminBellEvent =
  | {
      kind: 'leave.submitted';
      leaveRequestId: string;
      employeeName: string;
      leaveTypeName: string;
      startDate: string; // YYYY-MM-DD
      endDate: string;
    }
  | {
      kind: 'advance.submitted';
      cashAdvanceId: string;
      employeeName: string;
      amount: string; // pre-formatted, e.g. "5,000.00"
    }
  | {
      kind: 'attendance.disputed';
      attendanceId: string;
      employeeName: string;
      /** YYYY-MM-DD of the check-in. */
      date: string;
      /** Thai reason text from evaluateCheckIn(). */
      reason: string;
    }
  | {
      // Daily summary fired by the late-check cron — ONE notification per
      // day regardless of how many employees are late, to avoid bell spam.
      kind: 'attendance.late-summary';
      /** YYYY-MM-DD of today. */
      date: string;
      countNotCheckedIn: number;
      /** First few names for display; full list lives on /admin/attendance/live. */
      sampleEmployeeNames: string[];
    }
  | {
      // Per-employee daily ping from probation-reminder cron. Volume is
      // typically 0-1/day so individual notifications are fine here.
      kind: 'probation.ending';
      employeeId: string;
      employeeName: string;
      /** YYYY-MM-DD when probation ends. */
      endDate: string;
      daysRemaining: number;
    };

/**
 * Insert InAppBell notification rows for every active Admin/Owner.
 * Fire-and-forget — failures log but don't propagate. Safe to call
 * from any action's success path.
 */
export async function notifyAdminsInApp(event: AdminBellEvent): Promise<void> {
  try {
    const recipients = await prisma.user.findMany({
      where: {
        role: { in: ['Admin', 'Owner'] },
        archivedAt: null,
      },
      select: { id: true },
    });
    if (recipients.length === 0) return;

    await prisma.notification.createMany({
      data: recipients.map((r) => ({
        userId: r.id,
        channel: 'InAppBell' as const,
        event: event.kind,
        payload: event as Prisma.InputJsonValue,
        // sentAt = now() because InAppBell is "delivered" the instant
        // the row exists (Realtime push is the transport).
        sentAt: new Date(),
      })),
    });
  } catch (err) {
    console.error('[notifyAdminsInApp] failed (non-fatal)', {
      event: event.kind,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
