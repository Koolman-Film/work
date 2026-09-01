/**
 * Is this cash advance approved but not yet paid?
 *
 * "Approved" is two user-facing states, per the customer's two-step payment
 * request: อนุมัติ → รอจ่ายเงิน, then จ่ายเงินแล้ว. Resolved in ONE place so the
 * inbox label, the review modal's status badge, and the modal's primary button
 * can never disagree about which step a row is at.
 *
 * Deliberately free of `import 'server-only'`, unlike advance-row-vm.ts which
 * consumes it: only `vitest.integration.config.ts` aliases `server-only`, so a
 * predicate living there could not be reached by the fast unit suite. Same
 * split as `shouldSendDigest` and `computeLatePenalty` — the decision is pure,
 * the I/O around it is not.
 */
export function isAwaitingPayment(r: { status: string; paidAt: Date | null }): boolean {
  return r.status === 'Approved' && r.paidAt === null;
}
