import { describe, expect, it } from 'vitest';
import { paidPushNeeded, pickApprovalKind, SETTLE_WINDOW_MS } from './settle-window';

describe('SETTLE_WINDOW_MS', () => {
  it('is 15 minutes — the single source both sides must agree on', () => {
    expect(SETTLE_WINDOW_MS).toBe(15 * 60 * 1000);
  });
});

describe('pickApprovalKind', () => {
  it('paid by the time the window closes → one combined message', () => {
    expect(pickApprovalKind({ status: 'Approved', paidAt: new Date() })).toBe(
      'advance.approved-and-paid',
    );
  });

  it('not yet paid → the plain approval message', () => {
    expect(pickApprovalKind({ status: 'Approved', paidAt: null })).toBe('advance.approved');
  });

  it('no longer approved (cancelled/voided in the window) → send nothing', () => {
    expect(pickApprovalKind({ status: 'Cancelled', paidAt: null })).toBeNull();
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
});
