/**
 * Unit tests for markAdvancePaid — two-step payment step 2 (slip attach).
 * prisma.$transaction, headers, requirePermission, audit and sendNotification
 * are stubbed at the module boundary (same style as admin-line.test.ts).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => ({ get: () => null })),
}));

vi.mock('@/lib/auth/check-permission', () => ({
  requirePermission: vi.fn(async () => ({
    user: { id: 'admin-user-1' },
    authUserId: 'auth-uid-1',
  })),
}));

vi.mock('@/lib/audit/log', () => ({
  auditLog: vi.fn(),
  auditLogTx: vi.fn(async () => undefined),
}));

vi.mock('@/lib/inngest/events', () => ({
  sendNotification: vi.fn(async () => undefined),
}));

vi.mock('@/lib/notifications/admin-line', () => ({
  notifyAdminsOnLine: vi.fn(async () => undefined),
}));

vi.mock('@/lib/notifications/in-app-bell', () => ({
  notifyAdminsInApp: vi.fn(async () => undefined),
}));

vi.mock('@/lib/advance/available', () => ({
  advanceBalanceFor: vi.fn(),
}));

vi.mock('@/lib/advance/balance', () => ({
  isOverCap: vi.fn(() => false),
}));

const txFindUnique = vi.fn();
const txUpdate = vi.fn<
  (args: { where: unknown; data: Record<string, unknown> }) => Promise<unknown>
>(async () => ({}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ cashAdvance: { findUnique: txFindUnique, update: txUpdate } }),
    ),
    cashAdvance: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    employee: { findUnique: vi.fn() },
  },
}));

import { Prisma } from '@prisma/client';
import { auditLogTx } from '@/lib/audit/log';
import { sendNotification } from '@/lib/inngest/events';
import { markAdvancePaid } from './admin';

const mockedSend = vi.mocked(sendNotification);

const VALID_KEY = 'auth-uid-1/advance-receipts/ca-1.jpg';

function approvedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ca-1',
    status: 'Approved',
    amount: new Prisma.Decimal('1500'),
    paidAt: null,
    receiptUrl: null,
    employee: { firstName: 'สมชาย', userId: 'worker-1' },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  txUpdate.mockResolvedValue({});
});

describe('markAdvancePaid', () => {
  it('approved row + valid storage key → updates receiptUrl and sets paidAt', async () => {
    txFindUnique.mockResolvedValue(approvedRow());

    const r = await markAdvancePaid({ cashAdvanceId: 'ca-1', receiptKey: VALID_KEY });

    expect(r).toEqual({ ok: true });
    expect(txUpdate).toHaveBeenCalledTimes(1);
    const data = txUpdate.mock.calls[0]![0]!.data;
    expect(data.receiptUrl).toBe(VALID_KEY);
    expect(data.paidAt).toBeInstanceOf(Date);
  });

  it('row already paid → receiptUrl replaced, paidAt not in update data', async () => {
    txFindUnique.mockResolvedValue(
      approvedRow({ paidAt: new Date('2026-06-01T00:00:00Z'), receiptUrl: 'old-key' }),
    );

    const r = await markAdvancePaid({ cashAdvanceId: 'ca-1', receiptKey: VALID_KEY });

    expect(r).toEqual({ ok: true });
    const data = txUpdate.mock.calls[0]![0]!.data;
    expect(data.receiptUrl).toBe(VALID_KEY);
    expect('paidAt' in data).toBe(false);
  });

  it.each(['Pending', 'Rejected'])('%s row → not-approved, no update', async (status) => {
    txFindUnique.mockResolvedValue(approvedRow({ status }));

    const r = await markAdvancePaid({ cashAdvanceId: 'ca-1', receiptKey: VALID_KEY });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not-approved');
    expect(txUpdate).not.toHaveBeenCalled();
  });

  it('foreign storage key (not own prefix, not http) → forbidden, no db call', async () => {
    const r = await markAdvancePaid({
      cashAdvanceId: 'ca-1',
      receiptKey: 'other-uid/advance-receipts/ca-1.jpg',
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('forbidden');
    expect(txFindUnique).not.toHaveBeenCalled();
    expect(txUpdate).not.toHaveBeenCalled();
  });

  it('first attach → sendNotification once with advance.paid + formatted amount', async () => {
    txFindUnique.mockResolvedValue(approvedRow());

    await markAdvancePaid({ cashAdvanceId: 'ca-1', receiptKey: VALID_KEY });

    expect(mockedSend).toHaveBeenCalledTimes(1);
    expect(mockedSend).toHaveBeenCalledWith('worker-1', {
      kind: 'advance.paid',
      cashAdvanceId: 'ca-1',
      employeeFirstName: 'สมชาย',
      amount: '1,500.00',
    });
  });

  it('re-upload (paidAt already set) → sendNotification NOT called', async () => {
    txFindUnique.mockResolvedValue(approvedRow({ paidAt: new Date() }));

    await markAdvancePaid({ cashAdvanceId: 'ca-1', receiptKey: VALID_KEY });

    expect(mockedSend).not.toHaveBeenCalled();
    expect(auditLogTx).toHaveBeenCalledTimes(1);
  });

  it('soft-deleted advance (deletedAt set) → not-found, no update', async () => {
    // findUnique with deletedAt:null filter returns null for soft-deleted rows
    txFindUnique.mockResolvedValue(null);

    const r = await markAdvancePaid({ cashAdvanceId: 'ca-deleted', receiptKey: VALID_KEY });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not-found');
    expect(txUpdate).not.toHaveBeenCalled();
  });

  it('Approved + isDeducted + paidAt null → ok:true, paidAt set, sendNotification NOT called', async () => {
    txFindUnique.mockResolvedValue(approvedRow({ isDeducted: true, paidAt: null }));

    const r = await markAdvancePaid({ cashAdvanceId: 'ca-1', receiptKey: VALID_KEY });

    expect(r).toEqual({ ok: true });
    const data = txUpdate.mock.calls[0]![0]!.data;
    expect(data.paidAt).toBeInstanceOf(Date);
    expect(mockedSend).not.toHaveBeenCalled();
  });
});
