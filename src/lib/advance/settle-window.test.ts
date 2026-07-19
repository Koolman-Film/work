import { describe, expect, it } from 'vitest';
import { paidPushNeeded, pickApprovalKind, SETTLE_WINDOW_MS } from './settle-window';

describe('SETTLE_WINDOW_MS', () => {
  it('is 15 minutes — the single source both sides must agree on', () => {
    expect(SETTLE_WINDOW_MS).toBe(15 * 60 * 1000);
  });
});

describe('pickApprovalKind', () => {
  const approvedAt = new Date('2026-07-19T10:00:00Z');

  it('paid inside the window by the time it closes → one combined message', () => {
    expect(
      pickApprovalKind({
        status: 'Approved',
        deletedAt: null,
        approvedAt,
        paidAt: new Date('2026-07-19T10:05:00Z'),
      }),
    ).toBe('advance.approved-and-paid');
  });

  it('not yet paid → the plain approval message', () => {
    expect(
      pickApprovalKind({ status: 'Approved', deletedAt: null, approvedAt, paidAt: null }),
    ).toBe('advance.approved');
  });

  it('paid on/after the window boundary → plain approval, NOT combined (markAdvancePaid already pushed its own advance.paid for this)', () => {
    expect(
      pickApprovalKind({
        status: 'Approved',
        deletedAt: null,
        approvedAt,
        paidAt: new Date('2026-07-19T10:15:00Z'), // exactly at the boundary
      }),
    ).toBe('advance.approved');
    expect(
      pickApprovalKind({
        status: 'Approved',
        deletedAt: null,
        approvedAt,
        paidAt: new Date('2026-07-19T10:20:00Z'), // well after
      }),
    ).toBe('advance.approved');
  });

  it('voided meanwhile (deletedAt set) → send nothing, even though status is still Approved', () => {
    // voidCashAdvance (src/lib/advance/void.ts) sets deletedAt but leaves
    // status untouched — this is the exact shape a soft-deleted row has when
    // read back through findUnique, which the soft-delete extension does not
    // filter. See the comment on pickApprovalKind for why this field exists.
    expect(
      pickApprovalKind({
        status: 'Approved',
        deletedAt: new Date('2026-07-19T10:02:00Z'),
        approvedAt,
        paidAt: null,
      }),
    ).toBeNull();

    // Also true even if payment somehow landed too — voided wins.
    expect(
      pickApprovalKind({
        status: 'Approved',
        deletedAt: new Date('2026-07-19T10:02:00Z'),
        approvedAt,
        paidAt: new Date('2026-07-19T10:05:00Z'),
      }),
    ).toBeNull();
  });

  // This pins a status value (Cancelled) that cancelCashAdvance can never
  // actually leave an Approved advance in: cancelCashAdvance
  // (src/lib/advance/actions.ts) refuses any advance whose status isn't
  // Pending, and AdvanceStatus (prisma/schema.prisma) has no 'Paid' value —
  // so an approved advance has no code path back out of 'Approved' except
  // the void above (covered separately, by deletedAt). The guard is kept
  // anyway because it's cheap and AdvanceStatus could gain a value later;
  // this test documents that it currently protects against nothing reachable
  // in production, not that 'Cancelled' is a real post-approval state today.
  it('status no longer Approved (currently unreachable in practice — see comment) → send nothing', () => {
    expect(
      pickApprovalKind({ status: 'Cancelled', deletedAt: null, approvedAt, paidAt: null }),
    ).toBeNull();
  });
});

describe('paidPushNeeded', () => {
  const approvedAt = new Date('2026-07-19T10:00:00Z');

  it('paid inside the window → no separate push, the combined one covers it', () => {
    expect(paidPushNeeded({ approvedAt, paidAt: new Date('2026-07-19T10:05:00Z') })).toBe(false);
  });

  it('paid after the window → the approval message already went out, so push', () => {
    expect(paidPushNeeded({ approvedAt, paidAt: new Date('2026-07-19T10:20:00Z') })).toBe(true);
  });

  it('exactly at the boundary counts as outside — never leave the employee with no message', () => {
    expect(paidPushNeeded({ approvedAt, paidAt: new Date('2026-07-19T10:15:00Z') })).toBe(true);
  });

  it('missing approvedAt → push (fail toward telling the employee)', () => {
    expect(paidPushNeeded({ approvedAt: null, paidAt: new Date() })).toBe(true);
  });

  // pickApprovalKind and paidPushNeeded must be exact complements around the
  // boundary — otherwise there is a band where both sides push (duplicate)
  // or neither does (silence). Assert the complement directly rather than
  // trusting the two implementations to agree by accident.
  it("is the exact complement of pickApprovalKind's combined-message decision at every point around the boundary", () => {
    const offsetsMs = [
      -1000,
      0,
      1000,
      SETTLE_WINDOW_MS - 1,
      SETTLE_WINDOW_MS,
      SETTLE_WINDOW_MS + 1,
    ];
    for (const offset of offsetsMs) {
      const paidAt = new Date(approvedAt.getTime() + offset);
      const needsOwnPush = paidPushNeeded({ approvedAt, paidAt });
      const kind = pickApprovalKind({ status: 'Approved', deletedAt: null, approvedAt, paidAt });
      expect(kind).toBe(needsOwnPush ? 'advance.approved' : 'advance.approved-and-paid');
    }
  });
});
