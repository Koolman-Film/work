/**
 * Integration tests: branch-scope enforcement in createManualAttendance.
 *
 * Strategy: mock every boundary (next/navigation, next/headers, next/cache,
 * auth, prisma, audit) — then call the REAL function and assert gate +
 * mutation behaviour.
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
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
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
const employeeFindUnique = vi.fn();
const attendanceFindFirst = vi.fn();
const attendanceFindMany = vi.fn();
const attendanceCreate = vi.fn();
const payrollConfigFindFirst = vi.fn();
const holidayFindFirst = vi.fn();
const leaveConfigFindFirst = vi.fn();

vi.mock('@/lib/db/prisma', () => ({
  prismaRaw: {},
  prisma: {
    employee: {
      findUnique: (...a: unknown[]) => employeeFindUnique(...a),
    },
    payrollConfig: {
      findFirst: (...a: unknown[]) => payrollConfigFindFirst(...a),
    },
    holiday: {
      findFirst: (...a: unknown[]) => holidayFindFirst(...a),
    },
    leaveConfig: {
      findFirst: (...a: unknown[]) => leaveConfigFindFirst(...a),
    },
    attendance: {
      findFirst: (...a: unknown[]) => attendanceFindFirst(...a),
      findMany: (...a: unknown[]) => attendanceFindMany(...a),
      create: (...a: unknown[]) => attendanceCreate(...a),
    },
    $transaction: (cb: (tx: unknown) => unknown) =>
      cb({
        attendance: {
          create: (...a: unknown[]) => attendanceCreate(...a),
        },
      }),
  },
}));

// This suite is about branch-scope gating, not lateness — default the
// leave-aware lateness reads so createManualAttendance runs end to end.
beforeEach(() => {
  attendanceFindMany.mockResolvedValue([]);
  leaveConfigFindFirst.mockResolvedValue({
    morningStart: '09:00',
    morningEnd: '12:00',
    afternoonStart: '13:00',
    afternoonEnd: '17:00',
  });
});

import type { CreateManualInput } from './manual';
import { createManualAttendance } from './manual';

// ── helpers ───────────────────────────────────────────────────────────────────

function scopedActorAssignments(branchId: string) {
  return [
    {
      branchId,
      role: {
        permissions: ['attendance.manual-create'],
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
        permissions: ['attendance.manual-create'],
        isSuperadmin: false,
        archivedAt: null,
      },
    },
  ];
}

/** Valid input that passes all validation (past date, absent kind). */
const validInput: CreateManualInput = {
  employeeId: 'emp-1',
  date: '2025-01-15',
  kind: 'absent',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createManualAttendance — branch-scope gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({ user: { id: 'actor-id' } });
    attendanceFindFirst.mockResolvedValue(null); // no duplicate / no existing check-in
    attendanceCreate.mockResolvedValue({ id: 'new-att-id', type: 'Absent' });
    payrollConfigFindFirst.mockResolvedValue(null);
    holidayFindFirst.mockResolvedValue(null);
  });

  it('denies when scoped actor (branch A) targets employee whose home=B, assigned=[]', async () => {
    getUserAssignments.mockResolvedValue(scopedActorAssignments('branch-A'));

    employeeFindUnique.mockResolvedValue({
      id: 'emp-1',
      archivedAt: null,
      status: 'Active',
      branchId: 'branch-B',
      assignedBranchIds: [],
      workSchedule: null,
    });

    await expect(createManualAttendance(validInput)).rejects.toThrow('NOT_FOUND');

    // No attendance row should be created
    expect(attendanceCreate).not.toHaveBeenCalled();
  });

  it('allows when scoped actor (branch A) targets rotating employee: home=B, assigned=[A]', async () => {
    getUserAssignments.mockResolvedValue(scopedActorAssignments('branch-A'));

    employeeFindUnique.mockResolvedValue({
      id: 'emp-1',
      archivedAt: null,
      status: 'Active',
      branchId: 'branch-B',
      assignedBranchIds: ['branch-A'],
      workSchedule: null,
    });

    const result = await createManualAttendance(validInput);

    expect(result).toEqual({ ok: true, ids: ['new-att-id'] });
    expect(attendanceCreate).toHaveBeenCalledOnce();
  });

  it('allows when global actor targets employee at any branch', async () => {
    getUserAssignments.mockResolvedValue(globalActorAssignments());

    employeeFindUnique.mockResolvedValue({
      id: 'emp-1',
      archivedAt: null,
      status: 'Active',
      branchId: 'branch-Z',
      assignedBranchIds: [],
      workSchedule: null,
    });

    const result = await createManualAttendance(validInput);

    expect(result).toEqual({ ok: true, ids: ['new-att-id'] });
    expect(attendanceCreate).toHaveBeenCalledOnce();
  });

  it('returns employee-not-found before any auth check when employee does not exist', async () => {
    employeeFindUnique.mockResolvedValue(null);

    const result = await createManualAttendance(validInput);

    expect(result).toEqual({
      ok: false,
      code: 'employee-not-found',
      message: expect.any(String),
    });
    // auth should not have been checked
    expect(requirePermission).not.toHaveBeenCalled();
    expect(attendanceCreate).not.toHaveBeenCalled();
  });

  it('denies cross-branch even when employee is active and has valid date', async () => {
    getUserAssignments.mockResolvedValue(scopedActorAssignments('branch-A'));

    employeeFindUnique.mockResolvedValue({
      id: 'emp-1',
      archivedAt: null,
      status: 'Active',
      branchId: 'branch-C',
      assignedBranchIds: ['branch-D'], // neither is branch-A
      workSchedule: null,
    });

    await expect(createManualAttendance(validInput)).rejects.toThrow('NOT_FOUND');
    expect(attendanceCreate).not.toHaveBeenCalled();
  });
});
