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

/**
 * Which approval message to send once the window closes; null = send none.
 *
 * `deletedAt` must be passed explicitly by the caller — `findUnique` is NOT
 * covered by the soft-delete Prisma extension (it only wraps
 * findFirst/findMany/count/aggregate, see soft-delete-extension.ts), so a
 * voided advance still comes back from `findUnique` with `status: 'Approved'`
 * (void only sets `deletedAt`, it never touches `status`). Do not assume the
 * extension filtered this out — it didn't; that assumption is exactly what
 * produced the bug this field guards against (an admin voids by mistake
 * inside the settle window and the employee still gets "approved" pushed).
 */
export function pickApprovalKind(advance: {
  status: string;
  deletedAt: Date | null;
  approvedAt: Date | null;
  paidAt: Date | null;
}): 'advance.approved' | 'advance.approved-and-paid' | null {
  if (advance.deletedAt) return null; // voided meanwhile — see comment above
  // Guard kept cheap even though it is currently unreachable: cancelCashAdvance
  // (src/lib/advance/actions.ts) only ever cancels a Pending advance, and
  // AdvanceStatus has no 'Paid' value, so a row that is already Approved has
  // no code path back out of 'Approved' other than the void above. This does
  // NOT protect against anything today — it protects against AdvanceStatus
  // gaining a new value later without someone remembering to update this file.
  if (advance.status !== 'Approved') return null;
  if (!advance.paidAt) return 'advance.approved';
  // Same predicate markAdvancePaid uses to decide whether IT still needs its
  // own push, applied in reverse: if markAdvancePaid did NOT need one
  // (payment landed inside the window), this notice must say "paid" or the
  // employee never hears about it. If markAdvancePaid DID need one (payment
  // landed on/after the window boundary), that push already covers it, so
  // this notice stays plain "approved" to avoid a duplicate. Comparing the
  // same two timestamps with the same predicate on both sides is what makes
  // them complementary by construction — see paidPushNeeded below.
  return paidPushNeeded({ approvedAt: advance.approvedAt, paidAt: advance.paidAt })
    ? 'advance.approved'
    : 'advance.approved-and-paid';
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
