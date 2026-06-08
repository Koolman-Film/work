/**
 * Typed event payloads + the sendNotification helper.
 *
 * Each event kind here has a Thai-LINE-message template in
 * `src/lib/line/flex-templates.ts`. Adding a new kind requires both a
 * type entry here AND a template function there — keep them in sync.
 *
 * Why one event with kind discriminator (not separate events per
 * kind):
 *   The downstream pipeline (look up LINE userId → push → mark sent)
 *   is identical regardless of message contents. The kind is just the
 *   template selector. A single event subscription is simpler than 6
 *   parallel ones, and the dashboard groups them under one function.
 */

import { inngest } from './client';

export type NotificationKind =
  | 'leave.approved'
  | 'leave.rejected'
  | 'advance.approved'
  | 'advance.rejected'
  | 'attendance.dispute-approved'
  | 'attendance.dispute-rejected';

/**
 * Kind-specific payload shapes. Discriminated by `kind`.
 *
 * IMPORTANT: every field used in a Flex template MUST live in the
 * payload — Inngest receives the event from one server process and
 * passes it to another via durable storage. The function CAN re-fetch
 * from the DB (Employee, LeaveRequest, etc.) but doing so adds two
 * round-trips per push. Cheaper to embed the display fields in the
 * payload.
 */
export type NotificationPayload =
  | {
      kind: 'leave.approved' | 'leave.rejected';
      leaveRequestId: string;
      employeeFirstName: string;
      leaveTypeName: string;
      /** YYYY-MM-DD */
      startDate: string;
      /** YYYY-MM-DD */
      endDate: string;
      /** Working days expanded (approved) — null on reject. */
      workingDays: number | null;
      /** Preformatted days+hours duration ("1 วัน 3 ชม.") for approved leave;
       *  preferred over workingDays in the flex message. Omitted on reject. */
      durationLabel?: string | null;
      reviewNote: string | null;
    }
  | {
      kind: 'advance.approved' | 'advance.rejected';
      cashAdvanceId: string;
      employeeFirstName: string;
      /** Formatted as a string ("12,500.00") to preserve Decimal precision
       *  through the JSON serialisation Inngest does internally. */
      amount: string;
    }
  | {
      kind: 'attendance.dispute-approved' | 'attendance.dispute-rejected';
      attendanceId: string;
      employeeFirstName: string;
      /** YYYY-MM-DD of the attendance row's `date` field */
      date: string;
      reviewNote: string;
    };

export type NotificationSendEvent = {
  data: NotificationPayload & {
    /** User.id (NOT auth.users.id) of the recipient. */
    recipientUserId: string;
  };
};

/**
 * Idempotency key for an event — Inngest dedupes events with the same
 * `id` within a ~24h window. We construct deterministically from the
 * underlying entity + kind so re-firing the same notification (e.g.
 * the admin clicks approve twice through a network retry) doesn't
 * spam the employee with duplicate pushes.
 */
function notificationIdempotencyKey(payload: NotificationPayload): string {
  switch (payload.kind) {
    case 'leave.approved':
    case 'leave.rejected':
      return `notif:${payload.kind}:${payload.leaveRequestId}`;
    case 'advance.approved':
    case 'advance.rejected':
      return `notif:${payload.kind}:${payload.cashAdvanceId}`;
    case 'attendance.dispute-approved':
    case 'attendance.dispute-rejected':
      return `notif:${payload.kind}:${payload.attendanceId}`;
  }
}

/**
 * Fire-and-await: queues the event with Inngest. Returns once Inngest
 * has acknowledged ingestion (typically <100ms). Caller doesn't wait
 * for the actual push to complete — that happens asynchronously in
 * the Inngest function with retries.
 */
export async function sendNotification(
  recipientUserId: string,
  payload: NotificationPayload,
): Promise<void> {
  await inngest.send({
    id: notificationIdempotencyKey(payload),
    name: 'notification.send',
    data: { ...payload, recipientUserId },
  });
}
