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
import { notificationEventId } from './notification-id';

export type NotificationKind =
  | 'leave.approved'
  | 'leave.rejected'
  | 'advance.approved'
  | 'advance.rejected'
  // 'attendance.dispute-approved' has zero producers as of the dispute-review
  // push reduction (src/lib/attendance/admin-review.ts): approving a dispute
  // tells the employee "your check-in was fine, nothing to do" — no action,
  // no pay impact — so it's no longer pushed. Kept here (type, Flex template,
  // notification-id case) for one deploy cycle only: approvals queued before
  // this deploy may still be in flight and must still render on the new
  // code. Safe to delete everywhere once a deploy cycle has passed with no
  // in-flight events left.
  | 'attendance.dispute-approved'
  | 'attendance.dispute-rejected'
  | 'payroll.published'
  | 'advance.paid'
  // Sent by advance-approval-notify.ts once the settle window closes, when
  // the advance was ALSO paid within that window — replaces the separate
  // advance.approved + advance.paid pushes for the common same-click case.
  // See src/lib/advance/settle-window.ts.
  | 'advance.approved-and-paid'
  // The three `admin.*-submitted` kinds below have zero producers as of the
  // 08:30 digest replacing per-event admin fan-out (see admin-line.ts) —
  // nothing calls sendNotification with these kinds anymore. They are kept
  // here (type, Flex template, notification-id case, tests, locale strings)
  // for one deploy cycle only: events queued before this deploy may still be
  // in flight and must render correctly on the new code. Safe to delete
  // everywhere once a deploy cycle has passed with no in-flight events left.
  | 'admin.leave-submitted'
  | 'admin.advance-submitted'
  | 'admin.dispute-submitted'
  | 'admin.daily-digest';

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
      kind: 'advance.approved' | 'advance.rejected' | 'advance.approved-and-paid';
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
  // No producer as of the 08:30 digest — see the note on `NotificationKind`
  // above. Retained for one deploy cycle to render events queued pre-deploy.
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
    }
  | {
      kind: 'admin.daily-digest';
      /** Pending counts scoped to this admin's branches. */
      leave: number;
      advance: number;
      attendance: number;
    };

export type NotificationSendEvent = {
  data: NotificationPayload & {
    /** User.id (NOT auth.users.id) of the recipient. */
    recipientUserId: string;
  };
};

/**
 * Fire-and-await: queues the event with Inngest. Returns once Inngest
 * has acknowledged ingestion (typically <100ms). Caller doesn't wait
 * for the actual push to complete — that happens asynchronously in
 * the Inngest function with retries.
 *
 * NOTE — dedup window on deploy: the event-id format changed (recipient
 * suffix appended) so the 24h dedup window effectively resets at deploy
 * for in-flight worker notifications — a narrow duplicate-push window,
 * accepted.
 */
export async function sendNotification(
  recipientUserId: string,
  payload: NotificationPayload,
  opts?: { dedupeSuffix?: string },
): Promise<void> {
  await inngest.send({
    // Recipient suffix is required for admin fan-out: the same entity is
    // pushed to N admins, and without it Inngest would dedupe them down to
    // one event. A dedupeSuffix (resend only) appends a fresh token so a
    // deliberate re-send escapes the 24h dedup window.
    id: notificationEventId(payload, recipientUserId, opts?.dedupeSuffix),
    name: 'notification.send',
    data: { ...payload, recipientUserId },
  });
}

/** Payload for `advance.approval-decided` — see advance-approval-notify.ts. */
export type AdvanceApprovalDecidedEvent = {
  data: {
    cashAdvanceId: string;
    /** User.id (NOT auth.users.id) of the recipient. */
    recipientUserId: string;
  };
};

/**
 * Fired by approveCashAdvance instead of pushing `advance.approved`
 * directly. The advance-approval-notify Inngest function sleeps out
 * SETTLE_WINDOW_MS then decides, from the advance's live state, whether to
 * send the plain "approved" message or the combined "approved and paid"
 * one — see src/lib/advance/settle-window.ts for why.
 *
 * Keyed on cashAdvanceId alone (no recipient suffix): each advance is
 * approved at most once, so there is exactly one event per advance and no
 * admin-fan-out case that would need per-recipient dedup keys.
 */
export async function sendAdvanceApprovalDecided(data: {
  cashAdvanceId: string;
  recipientUserId: string;
}): Promise<void> {
  await inngest.send({
    id: `advance-approval-decided:${data.cashAdvanceId}`,
    name: 'advance.approval-decided',
    data,
  });
}
