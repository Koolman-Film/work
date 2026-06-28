/**
 * Integration tests: branch-scope act-on gating for employee mutation actions.
 *
 * Strategy: mock every boundary (next/navigation, next/headers, auth, prisma,
 * audit, supabase/admin) — then call the REAL functions and assert gate +
 * mutation behaviour for update / archive / delete / line-unlink.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── next/* mocks ─────────────────────────────────────────────────────────────
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  redirect: (u: string) => {
    throw new Error(`REDIRECT:${u}`);
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Map()) }));

// ── audit mock ───────────────────────────────────────────────────────────────
vi.mock('@/lib/audit/log', () => ({ auditLog: vi.fn() }));

// ── auth mocks ───────────────────────────────────────────────────────────────
const requirePermission = vi.fn();
const getUserAssignments = vi.fn();

vi.mock('@/lib/auth/check-permission', () => ({
  requirePermission: (...a: unknown[]) => requirePermission(...a),
  getUserAssignments: (...a: unknown[]) => getUserAssignments(...a),
  canDo: vi.fn(),
}));

// ── prisma mocks ─────────────────────────────────────────────────────────────
const empFindUnique = vi.fn();
const empUpdate = vi.fn();
const empDelete = vi.fn();
const userDelete = vi.fn();
const userUpdate = vi.fn();
const transactionFn = vi.fn();

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    employee: {
      findUnique: (...a: unknown[]) => empFindUnique(...a),
      update: (...a: unknown[]) => empUpdate(...a),
      delete: (...a: unknown[]) => empDelete(...a),
    },
    user: {
      delete: (...a: unknown[]) => userDelete(...a),
      update: (...a: unknown[]) => userUpdate(...a),
    },
    $transaction: (...a: unknown[]) => transactionFn(...a),
  },
}));

// ── supabase/admin mock (for deleteEmployee + unlinkLineFromEmployee) ─────────
vi.mock('@/lib/supabase/admin', () => ({
  getSupabaseAdminClient: () => ({
    auth: {
      admin: {
        deleteUser: vi.fn().mockResolvedValue({ error: null }),
      },
    },
    storage: {
      from: () => ({ remove: vi.fn().mockResolvedValue({ error: null }) }),
    },
  }),
}));

// ── employee-schema mock (for updateEmployee's readForm) ─────────────────────
vi.mock('./employee-schema', () => ({
  readForm: () => ({
    success: true,
    data: {
      firstName: 'Test',
      lastName: 'User',
      nickname: null,
      branchId: 'branch-X',
      assignedBranchIds: [],
      departmentId: null,
      accountingGroupId: null,
      workScheduleId: null,
      salaryType: 'Monthly',
      baseSalary: '10000',
      status: 'Active',
      canCheckIn: true,
      hasSso: false,
      hiredAt: new Date('2024-01-01'),
      photoKey: null,
      dateOfBirth: null,
      bankId: null,
      bankAccountNumber: null,
      bankAccountName: null,
      defaultOtRateType: null,
      defaultOtRatePerHour: null,
      defaultOtMultiplier: null,
    },
  }),
}));

// ── employee/assign-admin-role mock ───────────────────────────────────────────
vi.mock('@/lib/employee/assign-admin-role', () => ({
  assignAdminRole: vi.fn(),
}));

// ── employee/bank mock ───────────────────────────────────────────────────────
vi.mock('@/lib/employee/bank', () => ({
  maskBankAccountNumber: (v: string | null) => v,
}));

import { archiveEmployee, deleteEmployee, unlinkLineFromEmployee, updateEmployee } from './actions';

// ── helpers ───────────────────────────────────────────────────────────────────

function scopedAssignments(branchId: string, perm: string) {
  return [
    {
      branchId,
      role: { permissions: [perm], isSuperadmin: false, archivedAt: null },
    },
  ];
}

function globalAssignments(perm: string) {
  return [
    {
      branchId: null,
      role: { permissions: [perm], isSuperadmin: false, archivedAt: null },
    },
  ];
}

/** Full employee row for actions that load the full row. */
function fullEmpRow(branchId: string, assignedBranchIds: string[]) {
  return {
    id: 'e1',
    archivedAt: null,
    branchId,
    assignedBranchIds,
    firstName: 'Test',
    lastName: 'User',
    nickname: null,
    userId: 'user-1',
    photoKey: null,
    departmentId: null,
    accountingGroupId: null,
    workScheduleId: null,
    salaryType: 'Monthly',
    baseSalary: { toString: () => '10000' },
    status: 'Active',
    canCheckIn: true,
    hasSso: false,
    hiredAt: new Date('2024-01-01'),
    dateOfBirth: null,
    bankId: null,
    bankAccountNumber: null,
    bankAccountName: null,
    defaultOtRateType: null,
    defaultOtRatePerHour: null,
    defaultOtMultiplier: null,
  };
}

/** Minimal select row for deleteEmployee (has _count, user, branchId, assignedBranchIds). */
function deleteEmpRow(branchId: string, assignedBranchIds: string[]) {
  return {
    id: 'e1',
    userId: 'user-1',
    firstName: 'Test',
    lastName: 'User',
    photoKey: null,
    branchId,
    assignedBranchIds,
    user: { authUserId: null, lineUserId: null },
    _count: {
      attendances: 0,
      leaveRequests: 0,
      cashAdvances: 0,
      payrolls: 0,
      recurringDeductions: 0,
    },
  };
}

/** Minimal select row for unlinkLineFromEmployee. */
function unlinkEmpRow(branchId: string, assignedBranchIds: string[]) {
  return {
    id: 'e1',
    firstName: 'Test',
    lastName: 'User',
    nickname: null,
    branchId,
    assignedBranchIds,
    user: { id: 'user-1', authUserId: null, lineUserId: null },
  };
}

// ─── archiveEmployee ──────────────────────────────────────────────────────────

describe('archiveEmployee — branch act-on gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({ user: { id: 'actor' } });
    empUpdate.mockResolvedValue({});
  });

  it('denies a scoped actor (A) acting on an employee home=B assigned=[] — no mutation', async () => {
    getUserAssignments.mockResolvedValue(scopedAssignments('branch-A', 'employee.archive'));
    empFindUnique.mockResolvedValue(fullEmpRow('branch-B', []));

    await expect(archiveEmployee('e1')).rejects.toThrow('NOT_FOUND');
    expect(empUpdate).not.toHaveBeenCalled();
    expect(transactionFn).not.toHaveBeenCalled();
  });

  it('allows a scoped actor (A) on a rotating employee home=B assigned=[A]', async () => {
    getUserAssignments.mockResolvedValue(scopedAssignments('branch-A', 'employee.archive'));
    empFindUnique.mockResolvedValue(fullEmpRow('branch-B', ['branch-A']));

    await archiveEmployee('e1').catch(() => {});
    expect(empUpdate).toHaveBeenCalled();
  });

  it('allows a global actor on any employee', async () => {
    getUserAssignments.mockResolvedValue(globalAssignments('employee.archive'));
    empFindUnique.mockResolvedValue(fullEmpRow('branch-Z', []));

    await archiveEmployee('e1').catch(() => {});
    expect(empUpdate).toHaveBeenCalled();
  });
});

// ─── updateEmployee ───────────────────────────────────────────────────────────

describe('updateEmployee — branch act-on gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({ user: { id: 'actor' } });
    empUpdate.mockResolvedValue({});
  });

  it('denies a scoped actor (A) acting on an employee home=B assigned=[] — no mutation', async () => {
    getUserAssignments.mockResolvedValue(scopedAssignments('branch-A', 'employee.update'));
    empFindUnique.mockResolvedValue(fullEmpRow('branch-B', []));

    const fd = new FormData();
    await expect(updateEmployee('e1', fd)).rejects.toThrow('NOT_FOUND');
    expect(empUpdate).not.toHaveBeenCalled();
  });

  it('allows a scoped actor (A) on a rotating employee home=B assigned=[A]', async () => {
    getUserAssignments.mockResolvedValue(scopedAssignments('branch-A', 'employee.update'));
    empFindUnique.mockResolvedValue(fullEmpRow('branch-B', ['branch-A']));

    const fd = new FormData();
    await updateEmployee('e1', fd).catch(() => {});
    expect(empUpdate).toHaveBeenCalled();
  });

  it('allows a global actor on any employee', async () => {
    getUserAssignments.mockResolvedValue(globalAssignments('employee.update'));
    empFindUnique.mockResolvedValue(fullEmpRow('branch-Z', []));

    const fd = new FormData();
    await updateEmployee('e1', fd).catch(() => {});
    expect(empUpdate).toHaveBeenCalled();
  });
});

// ─── deleteEmployee ───────────────────────────────────────────────────────────

describe('deleteEmployee — branch act-on gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({ user: { id: 'actor' } });
    empDelete.mockResolvedValue({});
    userDelete.mockResolvedValue({});
    transactionFn.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        employee: { delete: (...a: unknown[]) => empDelete(...a) },
        user: { delete: (...a: unknown[]) => userDelete(...a) },
      }),
    );
  });

  it('denies a scoped actor (A) acting on an employee home=B assigned=[] — no mutation', async () => {
    getUserAssignments.mockResolvedValue(scopedAssignments('branch-A', 'employee.delete'));
    empFindUnique.mockResolvedValue(deleteEmpRow('branch-B', []));

    await expect(deleteEmployee('e1')).rejects.toThrow('NOT_FOUND');
    expect(transactionFn).not.toHaveBeenCalled();
    expect(empDelete).not.toHaveBeenCalled();
  });

  it('allows a scoped actor (A) on a rotating employee home=B assigned=[A]', async () => {
    getUserAssignments.mockResolvedValue(scopedAssignments('branch-A', 'employee.delete'));
    empFindUnique.mockResolvedValue(deleteEmpRow('branch-B', ['branch-A']));

    await deleteEmployee('e1').catch(() => {});
    expect(transactionFn).toHaveBeenCalled();
  });

  it('allows a global actor on any employee', async () => {
    getUserAssignments.mockResolvedValue(globalAssignments('employee.delete'));
    empFindUnique.mockResolvedValue(deleteEmpRow('branch-Z', []));

    await deleteEmployee('e1').catch(() => {});
    expect(transactionFn).toHaveBeenCalled();
  });
});

// ─── unlinkLineFromEmployee ───────────────────────────────────────────────────

describe('unlinkLineFromEmployee — branch act-on gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({ user: { id: 'actor' } });
    userUpdate.mockResolvedValue({});
    empUpdate.mockResolvedValue({});
    transactionFn.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        user: { update: (...a: unknown[]) => userUpdate(...a) },
        employee: { update: (...a: unknown[]) => empUpdate(...a) },
      }),
    );
  });

  it('denies a scoped actor (A) acting on an employee home=B assigned=[] — no mutation', async () => {
    getUserAssignments.mockResolvedValue(scopedAssignments('branch-A', 'employee.line-unlink'));
    // authUserId set so we don't short-circuit with "already unlinked"
    empFindUnique.mockResolvedValue({
      ...unlinkEmpRow('branch-B', []),
      user: { id: 'user-1', authUserId: 'auth-1', lineUserId: 'line-1' },
    });

    await expect(unlinkLineFromEmployee('e1')).rejects.toThrow('NOT_FOUND');
    expect(transactionFn).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('allows a scoped actor (A) on a rotating employee home=B assigned=[A]', async () => {
    getUserAssignments.mockResolvedValue(scopedAssignments('branch-A', 'employee.line-unlink'));
    // Give the employee an authUserId so the action doesn't short-circuit with "already unlinked"
    empFindUnique.mockResolvedValue({
      ...unlinkEmpRow('branch-B', ['branch-A']),
      user: { id: 'user-1', authUserId: 'auth-1', lineUserId: 'line-1' },
    });

    await unlinkLineFromEmployee('e1').catch(() => {});
    expect(transactionFn).toHaveBeenCalled();
  });

  it('allows a global actor on any employee', async () => {
    getUserAssignments.mockResolvedValue(globalAssignments('employee.line-unlink'));
    empFindUnique.mockResolvedValue({
      ...unlinkEmpRow('branch-Z', []),
      user: { id: 'user-1', authUserId: 'auth-1', lineUserId: 'line-1' },
    });

    await unlinkLineFromEmployee('e1').catch(() => {});
    expect(transactionFn).toHaveBeenCalled();
  });
});
