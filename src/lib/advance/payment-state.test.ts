import { describe, expect, it } from 'vitest';
import { isAwaitingPayment } from './payment-state';

/**
 * "Approved" is two user-facing states, per the customer's two-step payment
 * request: อนุมัติ → รอจ่ายเงิน, then จ่ายเงินแล้ว. This predicate is the only
 * thing that decides which of the two a row is in, so both the row VM's label
 * and the desktop modal's primary button read from it and cannot disagree.
 */
describe('isAwaitingPayment', () => {
  it('Approved with no paidAt is awaiting payment (รอจ่ายเงิน)', () => {
    expect(isAwaitingPayment({ status: 'Approved', paidAt: null })).toBe(true);
  });

  it('Approved and already paid is NOT awaiting payment (จ่ายเงินแล้ว)', () => {
    expect(isAwaitingPayment({ status: 'Approved', paidAt: new Date('2026-08-01') })).toBe(false);
  });

  it('a Pending row is not awaiting payment — it is awaiting approval', () => {
    expect(isAwaitingPayment({ status: 'Pending', paidAt: null })).toBe(false);
  });

  it('Rejected and Cancelled are never awaiting payment', () => {
    expect(isAwaitingPayment({ status: 'Rejected', paidAt: null })).toBe(false);
    expect(isAwaitingPayment({ status: 'Cancelled', paidAt: null })).toBe(false);
  });

  it('a paidAt on a non-Approved row does not make it awaiting payment either', () => {
    // Defensive: paidAt should never be set on a Cancelled row, but if data
    // ever drifts there, the answer is still "no payment step to offer".
    expect(isAwaitingPayment({ status: 'Cancelled', paidAt: new Date('2026-08-01') })).toBe(false);
  });
});
