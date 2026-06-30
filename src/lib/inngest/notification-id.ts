import type { NotificationPayload } from './events';

/**
 * Stable per-entity idempotency key. The Inngest 24h dedup window keys on
 * this plus the recipient suffix (see notificationEventId). Kept in its own
 * side-effect-free module so it can be unit-tested without importing the
 * Inngest client.
 */
export function notificationIdempotencyKey(payload: NotificationPayload): string {
  switch (payload.kind) {
    case 'leave.approved':
    case 'leave.rejected':
      return `notif:${payload.kind}:${payload.leaveRequestId}`;
    case 'advance.approved':
    case 'advance.rejected':
    // advance.paid re-fires when an admin re-uploads the transfer slip —
    // within Inngest's ~24h dedupe window the second push is dropped.
    // Intentional: the employee already got "paid" for that advance.
    // (key includes the recipientUserId suffix — still deterministic for
    // single-recipient worker kinds)
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
 * The Inngest event id. Appending a `dedupeSuffix` produces a fresh id so a
 * deliberate resend escapes the 24h dedup window (the default — no suffix —
 * is byte-for-byte the id every existing caller already produced).
 */
export function notificationEventId(
  payload: NotificationPayload,
  recipientUserId: string,
  dedupeSuffix?: string,
): string {
  const base = `${notificationIdempotencyKey(payload)}:${recipientUserId}`;
  return dedupeSuffix ? `${base}:${dedupeSuffix}` : base;
}
