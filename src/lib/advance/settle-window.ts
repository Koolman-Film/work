/**
 * The gap between approving a cash advance and paying it out.
 *
 * Measured on production: of 21 advances that were both approved and paid,
 * 19 were paid within an hour and the MEDIAN gap was zero minutes — admins
 * approve and pay in the same click. That sent the employee two LINE
 * messages seconds apart ("approved", then "transferred"), which is both
 * wasteful against a 300/month cap and worse to read than one message
 * saying both.
 *
 * So the approval notice waits out this window, then reports whatever is
 * true by then. Both the delayed notifier and markAdvancePaid consult these
 * helpers — the window must never be written as a literal in two places, or
 * the two sides drift and the employee gets either nothing or a duplicate.
 */

export const SETTLE_WINDOW_MS = 15 * 60 * 1000;

/** Which approval message to send once the window closes; null = send none. */
export function pickApprovalKind(advance: {
  status: string;
  paidAt: Date | null;
}): 'advance.approved' | 'advance.approved-and-paid' | null {
  if (advance.status !== 'Approved') return null; // cancelled or voided meanwhile
  return advance.paidAt ? 'advance.approved-and-paid' : 'advance.approved';
}

/**
 * Does marking-paid still need its own push? Only when payment landed after
 * the approval notice had already gone out. Ambiguity resolves toward
 * sending: a duplicate message is a nuisance, silence is a failure.
 */
export function paidPushNeeded(a: { approvedAt: Date | null; paidAt: Date }): boolean {
  if (!a.approvedAt) return true;
  return a.paidAt.getTime() - a.approvedAt.getTime() >= SETTLE_WINDOW_MS;
}
