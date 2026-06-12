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
  | 'attendance.dispute-rejected'
  | 'payroll.published'
  | 'advance.paid'
  | 'admin.leave-submitted'
  | 'admin.advance-submitted'
  | 'admin.dispute-submitted';

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
      /** Per-locale leave type names (LeaveType.nameByLocale); the flex
       *  template picks the recipient-locale name, falling back to
       *  leaveTypeName. Optional so older in-flight events still render. */
      leaveTypeNameByLocale?: Record<string, string> | null;
      /** YYYY-MM-DD */
      startDate: string;
      /** YYYY-MM-DD */
      endDate: string;
      /** Working days expanded (approved) — null on reject. */
      workingDays: number | null;
      /** Days+hours duration parts for approved leave; preferred over
       *  workingDays in the flex message, where they are rendered in the
       *  recipient's locale. Omitted on reject. */
      duration?: { days: number; hours: number; mins: number } | null;
      /** Frozen salary deduction (baht) for over-quota leave on a DeductPay
       *  type; null/absent when within quota. Approved-kind only. */
      deductAmount?: number | null;
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
    }
  | {
      kind: 'payroll.published';
      payrollId: string;
      /** YYYY-MM pay-period month — also the LIFF payslip deep-link param. */
      month: string;
      employeeFirstName: string;
      /** Formatted string ("12,500.00") — preserves Decimal precision through
       *  Inngest's JSON serialisation, same convention as advance amounts. */
      netPay: string;
    }
  | {
      kind: 'advance.paid';
      cashAdvanceId: string;
      employeeFirstName: string;
      /** Formatted string ("12,500.00") — same Decimal convention. */
      amount: string;
    }
  | {
      kind: 'admin.leave-submitted';
      leaveRequestId: string;
      employeeName: string;
      leaveTypeName: string;
      /** YYYY-MM-DD */
      startDate: string;
      /** YYYY-MM-DD */
      endDate: string;
    }
  | {
      kind: 'admin.advance-submitted';
      cashAdvanceId: string;
      employeeName: string;
      amount: string;
    }
  | {
      kind: 'admin.dispute-submitted';
      attendanceId: string;
      employeeName: string;
      /** YYYY-MM-DD */
      date: string;
      reason: string;
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
    // advance.paid re-fires when an admin re-uploads the transfer slip —
    // within Inngest's ~24h dedupe window the second push is dropped.
    // Intentional: the employee already got "paid" for that advance.
    case 'advance.paid':
    case 'admin.advance-submitted':
      return `notif:${payload.kind}:${payload.cashAdvanceId}`;
    case 'admin.leave-submitted':
      return `notif:${payload.kind}:${payload.leaveRequestId}`;
    case 'admin.dispute-submitted':
      return `notif:${payload.kind}:${payload.attendanceId}`;
    case 'attendance.dispute-approved':
    case 'attendance.dispute-rejected':
      return `notif:${payload.kind}:${payload.attendanceId}`;
    case 'payroll.published':
      return `notif:${payload.kind}:${payload.payrollId}`;
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
    // Recipient suffix is required for admin fan-out: the same entity is
    // pushed to N admins, and without it Inngest would dedupe them down to
    // one event. Harmless for worker kinds (single recipient → same
    // semantics as before).
    id: `${notificationIdempotencyKey(payload)}:${recipientUserId}`,
    name: 'notification.send',
    data: { ...payload, recipientUserId },
  });
}
