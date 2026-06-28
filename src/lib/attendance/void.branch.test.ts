/**
 * Integration tests: branch-scope enforcement in voidAttendance / restoreAttendance.
 *
 * Strategy: mock every boundary (next/navigation, next/headers, auth, prisma,
 * audit) — then call the REAL functions and assert gate + mutation behaviour.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── next/* mocks ────────────────────────────────────────────────────────────
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

// ── auth mocks ───────────────────────────────────────────────────────────────
const requirePermission = vi.fn();
const getUserAssignments = vi.fn();

vi.mock('@/lib/auth/check-permission', () => ({
  requirePermission: (...a: unknown[]) => requirePermission(...a),
  getUserAssignments: (...a: unknown[]) => getUserAssignments(...a),
}));

// ── prisma mocks ─────────────────────────────────────────────────────────────
const attendanceFindUniqueRaw = vi.fn();
const attendanceFindFirstRaw = vi.fn();
const attendanceFindUnique = vi.fn();
const attendanceUpdate = vi.fn();
const transactionFn = vi.fn();

vi.mock('@/lib/db/prisma', () => ({
  prismaRaw: {
    attendance: {
      findUnique: (...a: unknown[]) => attendanceFindUniqueRaw(...a),
      findFirst: (...a: unknown[]) => attendanceFindFirstRaw(...a),
    },
  },
  prisma: {
    attendance: {
      findUnique: (...a: unknown[]) => attendanceFindUnique(...a),
    },
    $transaction: (...a: unknown[]) => transactionFn(...a),
  },
}));

import { restoreAttendance, voidAttendance } from './void';

// ── helpers ───────────────────────────────────────────────────────────────────

/** Scoped actor: has attendance.void only at branch A */
function scopedActorAssignments(branchId: string) {
  return [
    {
      branchId,
      role: { permissions: ['attendance.void'], isSuperadmin: false, archivedAt: null },
    },
  ];
}

/** Global actor: holds attendance.void with a null-branchId (global) assignment */
function globalActorAssignments() {
  return [
    {
      branchId: null,
      role: { permissions: ['attendance.void'], isSuperadmin: false, archivedAt: null },
    },
  ];
}

function setupTransaction() {
  // Simulate prisma.$transaction passing a tx client into the callback
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

// ── Part A: voidAttendance ────────────────────────────────────────────────────

describe('voidAttendance — branch-scope gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({ user: { id: 'actor-id' } });
    setupTransaction();
    attendanceFindUnique.mockResolvedValue({ id: 'att-1' }); // inner tx findUnique
    attendanceUpdate.mockResolvedValue({});
  });

  it('denies when scoped actor (branch A) targets employee whose home=B, assigned=[]', async () => {
    getUserAssignments.mockResolvedValue(scopedActorAssignments('branch-A'));

    attendanceFindUniqueRaw.mockResolvedValue({
      id: 'att-1',
      deletedAt: null,
      employee: { branchId: 'branch-B', assignedBranchIds: [] },
    });

    await expect(voidAttendance('att-1', 'test reason')).rejects.toThrow('NOT_FOUND');

    // No mutation must fire
    expect(transactionFn).not.toHaveBeenCalled();
    expect(attendanceUpdate).not.toHaveBeenCalled();
  });

  it('allows when scoped actor (branch A) targets rotating employee: home=B, assigned=[A]', async () => {
    getUserAssignments.mockResolvedValue(scopedActorAssignments('branch-A'));

    attendanceFindUniqueRaw.mockResolvedValue({
      id: 'att-1',
      deletedAt: null,
      employee: { branchId: 'branch-B', assignedBranchIds: ['branch-A'] },
    });

    const result = await voidAttendance('att-1', 'test reason');

    expect(result).toEqual({ ok: true });
    // Transaction (update) must have been called
    expect(transactionFn).toHaveBeenCalledOnce();
    expect(attendanceUpdate).toHaveBeenCalledOnce();
  });

  it('allows when global actor targets employee at any branch', async () => {
    getUserAssignments.mockResolvedValue(globalActorAssignments());

    attendanceFindUniqueRaw.mockResolvedValue({
      id: 'att-1',
      deletedAt: null,
      employee: { branchId: 'branch-Z', assignedBranchIds: [] },
    });

    const result = await voidAttendance('att-1', 'test reason');

    expect(result).toEqual({ ok: true });
    expect(transactionFn).toHaveBeenCalledOnce();
    expect(attendanceUpdate).toHaveBeenCalledOnce();
  });

  it('returns reason-required before any auth check when reason is empty', async () => {
    const result = await voidAttendance('att-1', '');

    expect(result).toEqual({ ok: false, code: 'reason-required', message: expect.any(String) });
    // No DB, no auth
    expect(attendanceFindUniqueRaw).not.toHaveBeenCalled();
    expect(requirePermission).not.toHaveBeenCalled();
  });
});

// ── Part A: restoreAttendance ─────────────────────────────────────────────────

describe('restoreAttendance — branch-scope gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({ user: { id: 'actor-id' } });
    setupTransaction();
    attendanceFindFirstRaw.mockResolvedValue(null); // no live slot conflict
    attendanceUpdate.mockResolvedValue({});
  });

  it('denies when scoped actor (branch A) targets employee whose home=B, assigned=[]', async () => {
    getUserAssignments.mockResolvedValue(scopedActorAssignments('branch-A'));

    attendanceFindUniqueRaw.mockResolvedValue({
      id: 'att-1',
      deletedAt: new Date(),
      employeeId: 'emp-1',
      date: new Date(),
      type: 'CheckIn',
      employee: { branchId: 'branch-B', assignedBranchIds: [] },
    });

    await expect(restoreAttendance('att-1')).rejects.toThrow('NOT_FOUND');

    expect(transactionFn).not.toHaveBeenCalled();
    expect(attendanceUpdate).not.toHaveBeenCalled();
  });

  it('allows when scoped actor (branch A) targets rotating employee: home=B, assigned=[A]', async () => {
    getUserAssignments.mockResolvedValue(scopedActorAssignments('branch-A'));

    attendanceFindUniqueRaw.mockResolvedValue({
      id: 'att-1',
      deletedAt: new Date(),
      employeeId: 'emp-1',
      date: new Date(),
      type: 'CheckIn',
      employee: { branchId: 'branch-B', assignedBranchIds: ['branch-A'] },
    });

    const result = await restoreAttendance('att-1');

    expect(result).toEqual({ ok: true });
    expect(transactionFn).toHaveBeenCalledOnce();
    expect(attendanceUpdate).toHaveBeenCalledOnce();
  });

  it('allows when global actor targets employee at any branch', async () => {
    getUserAssignments.mockResolvedValue(globalActorAssignments());

    attendanceFindUniqueRaw.mockResolvedValue({
      id: 'att-1',
      deletedAt: new Date(),
      employeeId: 'emp-1',
      date: new Date(),
      type: 'CheckIn',
      employee: { branchId: 'branch-Z', assignedBranchIds: [] },
    });

    const result = await restoreAttendance('att-1');

    expect(result).toEqual({ ok: true });
    expect(transactionFn).toHaveBeenCalledOnce();
    expect(attendanceUpdate).toHaveBeenCalledOnce();
  });
});
