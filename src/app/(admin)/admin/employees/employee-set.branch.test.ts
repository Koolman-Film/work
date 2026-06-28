/**
 * Integration tests: branch-scope SET gating for createEmployee.
 *
 * Strategy: mock every boundary (next/navigation, next/headers, next/cache,
 * audit, auth, prisma, supabase/admin) — then call the REAL createEmployee
 * and assert that the branch-placement gate is enforced server-side.
 *
 * We drive the REAL getPermittedBranches / canSetEmployeeBranches — only
 * getUserAssignments is mocked at the boundary.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── next/* mocks ──────────────────────────────────────────────────────────────
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

// ── audit mock ────────────────────────────────────────────────────────────────
vi.mock('@/lib/audit/log', () => ({ auditLog: vi.fn() }));

// ── auth mocks ────────────────────────────────────────────────────────────────
const requirePermission = vi.fn();
const getUserAssignments = vi.fn();

vi.mock('@/lib/auth/check-permission', () => ({
  requirePermission: (...a: unknown[]) => requirePermission(...a),
  getUserAssignments: (...a: unknown[]) => getUserAssignments(...a),
  canDo: vi.fn(),
}));

// ── prisma mocks ──────────────────────────────────────────────────────────────
const employeeCreate = vi.fn();
const employeeFindUnique = vi.fn();
const employeeUpdate = vi.fn();
const userCreate = vi.fn();
const roleDefFindUnique = vi.fn();
const userRoleAssignmentCreateMany = vi.fn();
const transactionFn = vi.fn();

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    employee: {
      create: (...a: unknown[]) => employeeCreate(...a),
      findUnique: (...a: unknown[]) => employeeFindUnique(...a),
      update: (...a: unknown[]) => employeeUpdate(...a),
    },
    user: {
      create: (...a: unknown[]) => userCreate(...a),
    },
    roleDefinition: {
      findUnique: (...a: unknown[]) => roleDefFindUnique(...a),
    },
    userRoleAssignment: {
      createMany: (...a: unknown[]) => userRoleAssignmentCreateMany(...a),
    },
    $transaction: (...a: unknown[]) => transactionFn(...a),
  },
}));

// ── supabase/admin mock ───────────────────────────────────────────────────────
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

// ── employee/assign-admin-role mock ───────────────────────────────────────────
vi.mock('@/lib/employee/assign-admin-role', () => ({
  assignAdminRole: vi.fn(),
}));

// ── employee/bank mock ────────────────────────────────────────────────────────
vi.mock('@/lib/employee/bank', () => ({
  maskBankAccountNumber: (v: string | null) => v,
  // Match real behaviour: strip spaces/dashes, return null for blank
  normalizeBankAccountNumber: (v: string | null | undefined): string | null => {
    if (!v) return null;
    const digits = v.replace(/[\s-]/g, '');
    return digits === '' ? null : digits;
  },
}));

import { createEmployee, updateEmployee } from './actions';

// ── helpers ───────────────────────────────────────────────────────────────────

/** Build a FormData with all required fields so readForm parses successfully.
 *  branchId = home branch; assigned = the assignedBranchIds list.
 *  Both must be valid GUIDs so the Zod schema passes. */
function createFd(branchId: string, assigned: string[]): FormData {
  const f = new FormData();
  f.set('firstName', 'สมชาย');
  f.set('lastName', 'ใจดี');
  f.set('nickname', '');
  f.set('branchId', branchId);
  for (const b of assigned) f.append('assignedBranchIds', b);
  // optional relational fields — leave blank (→ null)
  f.set('departmentId', '');
  f.set('accountingGroupId', '');
  f.set('workScheduleId', '');
  // required enum + numeric fields
  f.set('salaryType', 'Monthly');
  f.set('baseSalary', '10000');
  f.set('status', 'Active');
  // checkboxes: absent = false (readForm reads '' → s === 'on' → false)
  f.set('canCheckIn', '');
  f.set('hasSso', '');
  // required date
  f.set('hiredAt', '2024-01-01');
  // optional profile extras — leave blank
  f.set('photoKey', '');
  f.set('dateOfBirth', '');
  f.set('bankId', '');
  f.set('bankAccountNumber', '');
  f.set('bankAccountName', '');
  f.set('defaultOtRateType', '');
  f.set('defaultOtRatePerHour', '');
  f.set('defaultOtMultiplier', '');
  return f;
}

/** tx stub that satisfies all operations inside the createEmployee $transaction */
function makeTxStub() {
  return {
    user: { create: (...a: unknown[]) => userCreate(...a) },
    employee: { create: (...a: unknown[]) => employeeCreate(...a) },
    roleDefinition: { findUnique: (...a: unknown[]) => roleDefFindUnique(...a) },
    userRoleAssignment: { createMany: (...a: unknown[]) => userRoleAssignmentCreateMany(...a) },
  };
}

// ── test suite ────────────────────────────────────────────────────────────────

describe('createEmployee — branch placement (subset)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({ user: { id: 'actor' } });

    // Transaction invokes the callback with a tx stub
    transactionFn.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(makeTxStub()));

    // tx.user.create → {id: 'new-user'}
    userCreate.mockResolvedValue({ id: 'new-user' });
    // tx.employee.create → {id: 'new-emp'}
    employeeCreate.mockResolvedValue({ id: 'new-emp' });
    // tx.roleDefinition.findUnique → {id: 'role-staff'}
    roleDefFindUnique.mockResolvedValue({ id: 'role-staff' });
    // tx.userRoleAssignment.createMany → {}
    userRoleAssignmentCreateMany.mockResolvedValue({});
  });

  it('scoped actor (A) submitting branch-B is rejected; no employee created', async () => {
    getUserAssignments.mockResolvedValue([
      {
        branchId: '00000000-0000-0000-0000-000000000001', // branch-A
        role: { permissions: ['employee.create'], isSuperadmin: false, archivedAt: null },
      },
    ]);

    await expect(
      createEmployee(
        createFd(
          '00000000-0000-0000-0000-000000000002', // branch-B
          ['00000000-0000-0000-0000-000000000002'],
        ),
      ),
    ).rejects.toThrow(/REDIRECT:.*error=/);

    expect(employeeCreate).not.toHaveBeenCalled();
  });

  it('scoped actor (A) submitting branch-A succeeds (reaches employee.create)', async () => {
    getUserAssignments.mockResolvedValue([
      {
        branchId: '00000000-0000-0000-0000-000000000001', // branch-A
        role: { permissions: ['employee.create'], isSuperadmin: false, archivedAt: null },
      },
    ]);

    // Will redirect after success — that's fine, we just want to confirm create was called
    await createEmployee(
      createFd(
        '00000000-0000-0000-0000-000000000001', // branch-A
        ['00000000-0000-0000-0000-000000000001'],
      ),
    ).catch(() => {
      // expected REDIRECT after success
    });

    expect(employeeCreate).toHaveBeenCalled();
  });

  it('global actor (branchId=null) can create in any branch', async () => {
    getUserAssignments.mockResolvedValue([
      {
        branchId: null, // global
        role: { permissions: ['employee.create'], isSuperadmin: false, archivedAt: null },
      },
    ]);

    await createEmployee(
      createFd(
        '00000000-0000-0000-0000-000000000099', // branch-Z (any)
        ['00000000-0000-0000-0000-000000000099'],
      ),
    ).catch(() => {
      // expected REDIRECT after success
    });

    expect(employeeCreate).toHaveBeenCalled();
  });
});

// ── updateEmployee — branch reassignment is global-only ───────────────────────

/** Reuse createFd (all required fields) for update submissions too. */
function editFd(branchId: string, assigned: string[]): FormData {
  return createFd(branchId, assigned);
}

/** Minimal before-record that updateEmployee reads from prisma.employee.findUnique */
function makeBeforeRecord(branchId: string, assignedBranchIds: string[]) {
  return {
    id: 'e1',
    branchId,
    assignedBranchIds,
    firstName: 'สมชาย',
    lastName: 'ใจดี',
    nickname: null,
    departmentId: null,
    accountingGroupId: null,
    workScheduleId: null,
    salaryType: 'Monthly',
    baseSalary: '10000',
    defaultOtRateType: null,
    defaultOtRatePerHour: null,
    defaultOtMultiplier: null,
    status: 'Active',
    canCheckIn: true,
    hasSso: false,
    hiredAt: new Date('2024-01-01'),
    photoKey: null,
    dateOfBirth: null,
    bankId: null,
    bankAccountNumber: null,
    bankAccountName: null,
    archivedAt: null,
    userId: 'user-1',
    inviteToken: null,
    inviteExpiresAt: null,
  };
}

// Stable UUID constants for update tests
const BRANCH_A = '00000000-0000-0000-0000-000000000001';
const BRANCH_B = '00000000-0000-0000-0000-000000000002';

describe('updateEmployee — branch reassignment is global-only', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({ user: { id: 'actor' } });
    employeeUpdate.mockResolvedValue({});
  });

  it('scoped actor cannot change branches: update persists EXISTING branches', async () => {
    getUserAssignments.mockResolvedValue([
      {
        branchId: BRANCH_A,
        role: { permissions: ['employee.update'], isSuperadmin: false, archivedAt: null },
      },
    ]);
    employeeFindUnique.mockResolvedValue(makeBeforeRecord(BRANCH_A, [BRANCH_A]));

    await updateEmployee('e1', editFd(BRANCH_B, [BRANCH_B])).catch(() => {
      // expected REDIRECT after success
    });

    expect(employeeUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ branchId: BRANCH_A, assignedBranchIds: [BRANCH_A] }),
      }),
    );
  });

  it('global actor can change branches: submitted values applied', async () => {
    getUserAssignments.mockResolvedValue([
      {
        branchId: null, // global
        role: { permissions: ['employee.update'], isSuperadmin: false, archivedAt: null },
      },
    ]);
    employeeFindUnique.mockResolvedValue(makeBeforeRecord(BRANCH_A, [BRANCH_A]));

    await updateEmployee('e1', editFd(BRANCH_B, [BRANCH_B])).catch(() => {
      // expected REDIRECT after success
    });

    expect(employeeUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ branchId: BRANCH_B }),
      }),
    );
  });
});
