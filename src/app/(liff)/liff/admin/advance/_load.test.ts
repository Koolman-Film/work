/**
 * Behavioral tests for the "รอแนบสลิป" list query (fix wave item 3 on
 * branch fix/advance-payout-selfie-provenance).
 *
 * Before this fix, the list filtered on `status='Approved' AND paidAt IS
 * NULL` only. Once an admin could mark an advance paid without a slip
 * (transfer-slip-optional), that same action set `paidAt` and the row fell
 * out of this list forever — with `receiptUrl` staying null and no other
 * list ever surfacing "paid, but still no slip".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const findMany = vi.fn();
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    cashAdvance: {
      findMany: (...a: unknown[]) => findMany(...a),
    },
  },
}));

import { awaitingSlipRowState, loadAwaitingSlipRows } from './_load';

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([]);
});

describe('loadAwaitingSlipRows — query shape', () => {
  it('widens the filter to paidAt IS NULL OR receiptUrl IS NULL (not paidAt IS NULL alone)', async () => {
    await loadAwaitingSlipRows('all');

    expect(findMany).toHaveBeenCalledTimes(1);
    const { where } = findMany.mock.calls[0]![0];
    expect(where.status).toBe('Approved');
    expect(where.deletedAt).toBeNull();
    expect(where.OR).toEqual([{ paidAt: null }, { receiptUrl: null }]);
    // The old, too-narrow shape must be gone.
    expect(where.paidAt).toBeUndefined();
  });

  it('still applies branch scope when the caller is scoped (not "all")', async () => {
    await loadAwaitingSlipRows(['branch-a']);

    const { where } = findMany.mock.calls[0]![0];
    expect(where.employee).toBeDefined();
  });
});

describe('awaitingSlipRowState', () => {
  it('unpaid (paidAt=null) → awaiting-payment, regardless of receiptUrl', () => {
    expect(awaitingSlipRowState({ paidAt: null, receiptUrl: null })).toBe('awaiting-payment');
    expect(awaitingSlipRowState({ paidAt: null, receiptUrl: 'some-key.jpg' })).toBe(
      'awaiting-payment',
    );
  });

  it('paid but no slip (paidAt set, receiptUrl=null) → awaiting-slip', () => {
    expect(awaitingSlipRowState({ paidAt: new Date(), receiptUrl: null })).toBe('awaiting-slip');
  });

  it('paid with a slip already → awaiting-payment fallback (should never be selected by the query)', () => {
    // Defensive: the query's OR should never actually return this combination,
    // but the pure function stays total rather than throwing.
    expect(awaitingSlipRowState({ paidAt: new Date(), receiptUrl: 'key.jpg' })).toBe(
      'awaiting-payment',
    );
  });
});
