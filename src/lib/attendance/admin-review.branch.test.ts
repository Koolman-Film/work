/**
 * Integration tests: branch-scope enforcement in approveDisputed / rejectDisputed.
 *
 * Strategy: mock every boundary (next/navigation, next/headers, auth, prisma,
 * audit, inngest) — then call the REAL functions and assert gate + mutation
 * behaviour.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── next/* mocks ─────────────────────────────────────────────────────────────
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Map()),
}));

// ── audit mock ───────────────────────────────────────────────────────────────
vi.mock('@/lib/audit/log', () => ({
  auditLog: vi.fn(),
  auditLogTx: vi.fn(),
}));

// ── inngest mock ──────────────────────────────────────────────────────────────
vi.mock('@/lib/inngest/events', () => ({
  sendNotification: vi.fn().mockResolvedValue(undefined),
}));

// ── auth mocks ───────────────────────────────────────────────────────────────
const requirePermission = vi.fn();
const getUserAssignments = vi.fn();

vi.mock('@/lib/auth/check-permission', () => ({
  requirePermission: (...a: unknown[]) => requirePermission(...a),
  getUserAssignments: (...a: unknown[]) => getUserAssignments(...a),
}));

// ── prisma mocks ─────────────────────────────────────────────────────────────
const attendanceFindUnique = vi.fn();
const attendanceUpdate = vi.fn();
const transactionFn = vi.fn();

vi.mock('@/lib/db/prisma', () => ({
  prismaRaw: {},
  prisma: {
    attendance: {
      findUnique: (...a: unknown[]) => attendanceFindUnique(...a),
    },
    $transaction: (...a: unknown[]) => transactionFn(...a),
  },
}));

import { approveDisputed, rejectDisputed } from './admin-review';

// ── helpers ───────────────────────────────────────────────────────────────────

function scopedActorAssignments(branchId: string) {
  return [
    {
      branchId,
      role: {
        permissions: ['attendance.dispute-resolve'],
        isSuperadmin: false,
        archivedAt: null,
      },
    },
  ];
}

function globalActorAssignments() {
  return [
    {
      branchId: null,
      role: {
        permissions: ['attendance.dispute-resolve'],
        isSuperadmin: false,
        archivedAt: null,
      },
    },
  ];
}

/** Disputed row returned by the outer findUnique (branch guard). */
function disputedOuterRow(branchId: string, assignedBranchIds: string[]) {
  return {
    employee: { branchId, assignedBranchIds },
  };
}

/** Row returned inside the $transaction by inner findUnique. */
function disputedInnerRow() {
  return {
    id: 'att-1',
    checkInStatus: 'Disputed',
    isOverridden: false,
    employeeId: 'emp-1',
    date: new Date('2025-01-15'),
    employee: { firstName: 'Test', userId: 'user-1' },
  };
}

function setupTransaction() {
  transactionFn.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({
      attendance: {
        findUnique: (...a: unknown[]) => attendanceFindUnique(...a),
        update: (...a: unknown[]) => attendanceUpdate(...a),
      },
      auditLog: { create: vi.fn() },
    }),
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('approveDisputed — branch-scope gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({ user: { id: 'actor-id' } });
    setupTransaction();
    attendanceUpdate.mockResolvedValue({
      checkInStatus: 'Confirmed',
      isOverridden: true,
      overrideNote: 'ok',
    });
  });

  it('denies when scoped actor (branch A) targets employee whose home=B, assigned=[]', async () => {
    getUserAssignments.mockResolvedValue(scopedActorAssignments('branch-A'));

    // outer findUnique (branch guard) — return branch B employee
    attendanceFindUnique.mockResolvedValueOnce(disputedOuterRow('branch-B', []));

    await expect(
      approveDisputed({ attendanceId: 'att-1', note: 'approve reason' }),
    ).rejects.toThrow('NOT_FOUND');

    // $transaction (with update) must NOT have been called
    expect(transactionFn).not.toHaveBeenCalled();
    expect(attendanceUpdate).not.toHaveBeenCalled();
  });

  it('allows when scoped actor (branch A) targets rotating employee: home=B, assigned=[A]', async () => {
    getUserAssignments.mockResolvedValue(scopedActorAssignments('branch-A'));

    // outer findUnique → rotating employee
    attendanceFindUnique.mockResolvedValueOnce(disputedOuterRow('branch-B', ['branch-A']));
    // inner findUnique (inside tx) → disputed row
    attendanceFindUnique.mockResolvedValueOnce(disputedInnerRow());

    const result = await approveDisputed({ attendanceId: 'att-1', note: 'approve reason' });

    expect(result).toEqual({ ok: true, nextStatus: 'Confirmed' });
    expect(transactionFn).toHaveBeenCalledOnce();
    expect(attendanceUpdate).toHaveBeenCalledOnce();
  });

  it('allows when global actor targets employee at any branch', async () => {
    getUserAssignments.mockResolvedValue(globalActorAssignments());

    attendanceFindUnique.mockResolvedValueOnce(disputedOuterRow('branch-Z', []));
    attendanceFindUnique.mockResolvedValueOnce(disputedInnerRow());

    const result = await approveDisputed({ attendanceId: 'att-1', note: 'approve reason' });

    expect(result).toEqual({ ok: true, nextStatus: 'Confirmed' });
    expect(transactionFn).toHaveBeenCalledOnce();
    expect(attendanceUpdate).toHaveBeenCalledOnce();
  });

  it('denies cross-branch actor even when employee has other assigned branches', async () => {
    getUserAssignments.mockResolvedValue(scopedActorAssignments('branch-A'));

    // Employee is at branch-C, also assigned to branch-D, but NOT branch-A
    attendanceFindUnique.mockResolvedValueOnce(disputedOuterRow('branch-C', ['branch-D']));

    await expect(
      approveDisputed({ attendanceId: 'att-1', note: 'approve reason' }),
    ).rejects.toThrow('NOT_FOUND');

    expect(transactionFn).not.toHaveBeenCalled();
    expect(attendanceUpdate).not.toHaveBeenCalled();
  });
});

describe('rejectDisputed — branch-scope gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({ user: { id: 'actor-id' } });
    setupTransaction();
    attendanceUpdate.mockResolvedValue({
      checkInStatus: 'Rejected',
      isOverridden: true,
      overrideNote: 'nope',
    });
  });

  it('denies when scoped actor (branch A) targets employee whose home=B, assigned=[]', async () => {
    getUserAssignments.mockResolvedValue(scopedActorAssignments('branch-A'));

    attendanceFindUnique.mockResolvedValueOnce(disputedOuterRow('branch-B', []));

    await expect(rejectDisputed({ attendanceId: 'att-1', note: 'reject reason' })).rejects.toThrow(
      'NOT_FOUND',
    );

    expect(transactionFn).not.toHaveBeenCalled();
    expect(attendanceUpdate).not.toHaveBeenCalled();
  });

  it('allows when scoped actor (branch A) targets rotating employee: home=B, assigned=[A]', async () => {
    getUserAssignments.mockResolvedValue(scopedActorAssignments('branch-A'));

    attendanceFindUnique.mockResolvedValueOnce(disputedOuterRow('branch-B', ['branch-A']));
    attendanceFindUnique.mockResolvedValueOnce(disputedInnerRow());

    const result = await rejectDisputed({ attendanceId: 'att-1', note: 'reject reason' });

    expect(result).toEqual({ ok: true, nextStatus: 'Rejected' });
    expect(transactionFn).toHaveBeenCalledOnce();
    expect(attendanceUpdate).toHaveBeenCalledOnce();
  });

  it('allows when global actor targets employee at any branch', async () => {
    getUserAssignments.mockResolvedValue(globalActorAssignments());

    attendanceFindUnique.mockResolvedValueOnce(disputedOuterRow('branch-Z', []));
    attendanceFindUnique.mockResolvedValueOnce(disputedInnerRow());

    const result = await rejectDisputed({ attendanceId: 'att-1', note: 'reject reason' });

    expect(result).toEqual({ ok: true, nextStatus: 'Rejected' });
    expect(transactionFn).toHaveBeenCalledOnce();
    expect(attendanceUpdate).toHaveBeenCalledOnce();
  });
});
