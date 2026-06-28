/**
 * Integration tests: branch-scope act-on gating for employee sub-actions.
 *
 * Covers:
 *   - setEmployeeDefaultLocale (locale-actions.ts) — perm employee.update, mutates user.update
 *   - upsertEntitlement (entitlements-actions.ts) — perm leave.entitlement.manage, mutates leaveEntitlement.upsert
 *
 * Strategy: mock every boundary (next/navigation, next/headers, next/cache,
 * audit, i18n/config, leave/leave-config, prisma) — then call the REAL
 * actions and exercise the REAL getPermittedBranches/canActOnEmployeeBranches
 * stack via getUserAssignments returning scoped vs global assignment lists.
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

// ── i18n mock — always accept locale values passed in tests ──────────────────
vi.mock('@/lib/i18n/config', () => ({
  isLocale: (v: unknown) => typeof v === 'string' && v.length > 0,
  LOCALES: ['th', 'en', 'my', 'lo', 'zh-CN', 'km'],
}));

// ── leave-config mock — return fixed standard day minutes (480 = 8 h) ────────
vi.mock('@/lib/leave/leave-config', () => ({
  getLeaveConfig: vi.fn().mockResolvedValue({
    morningStart: '09:00',
    morningEnd: '12:00',
    afternoonStart: '13:00',
    afternoonEnd: '17:00',
  }),
}));

// ── prisma mocks ─────────────────────────────────────────────────────────────
const empFindUnique = vi.fn();
const userUpdate = vi.fn();
const leaveEntitlementFindUnique = vi.fn();
const leaveEntitlementUpsert = vi.fn();
const leaveConfigFindFirst = vi.fn();

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    employee: {
      findUnique: (...a: unknown[]) => empFindUnique(...a),
    },
    user: {
      update: (...a: unknown[]) => userUpdate(...a),
    },
    leaveEntitlement: {
      findUnique: (...a: unknown[]) => leaveEntitlementFindUnique(...a),
      upsert: (...a: unknown[]) => leaveEntitlementUpsert(...a),
    },
    leaveConfig: {
      findFirst: (...a: unknown[]) => leaveConfigFindFirst(...a),
    },
  },
}));

import { upsertEntitlement } from './entitlements-actions';
import { setEmployeeDefaultLocale } from './locale-actions';

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

/** Employee row shape used by setEmployeeDefaultLocale. */
function localeEmpRow(branchId: string, assignedBranchIds: string[]) {
  return {
    branchId,
    assignedBranchIds,
    user: { id: 'user-1', locale: 'th' },
  };
}

/** Employee row shape used by upsertEntitlement (no user field needed). */
function entitlementEmpRow(branchId: string, assignedBranchIds: string[]) {
  return {
    branchId,
    assignedBranchIds,
  };
}

// ─── setEmployeeDefaultLocale ─────────────────────────────────────────────────

describe('setEmployeeDefaultLocale — branch act-on gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({ user: { id: 'actor' } });
    userUpdate.mockResolvedValue({});
    leaveConfigFindFirst.mockResolvedValue(null);
  });

  it('denies a scoped actor (A) acting on an employee home=B assigned=[] — no mutation', async () => {
    getUserAssignments.mockResolvedValue(scopedAssignments('branch-A', 'employee.update'));
    empFindUnique.mockResolvedValue(localeEmpRow('branch-B', []));

    const fd = new FormData();
    fd.append('locale', 'en');

    await expect(setEmployeeDefaultLocale('e1', fd)).rejects.toThrow('NOT_FOUND');
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('allows a scoped actor (A) on a rotating employee home=B assigned=[A]', async () => {
    getUserAssignments.mockResolvedValue(scopedAssignments('branch-A', 'employee.update'));
    empFindUnique.mockResolvedValue(localeEmpRow('branch-B', ['branch-A']));

    const fd = new FormData();
    fd.append('locale', 'en');

    await setEmployeeDefaultLocale('e1', fd).catch(() => {});
    expect(userUpdate).toHaveBeenCalled();
  });

  it('allows a global actor on any employee', async () => {
    getUserAssignments.mockResolvedValue(globalAssignments('employee.update'));
    empFindUnique.mockResolvedValue(localeEmpRow('branch-Z', []));

    const fd = new FormData();
    fd.append('locale', 'th');

    await setEmployeeDefaultLocale('e1', fd).catch(() => {});
    expect(userUpdate).toHaveBeenCalled();
  });
});

// ─── upsertEntitlement ────────────────────────────────────────────────────────

describe('upsertEntitlement — branch act-on gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({ user: { id: 'actor' } });
    leaveEntitlementFindUnique.mockResolvedValue(null);
    leaveEntitlementUpsert.mockResolvedValue({ id: 'ent-1' });
    leaveConfigFindFirst.mockResolvedValue(null);
  });

  it('denies a scoped actor (A) acting on an employee home=B assigned=[] — no mutation', async () => {
    getUserAssignments.mockResolvedValue(scopedAssignments('branch-A', 'leave.entitlement.manage'));
    empFindUnique.mockResolvedValue(entitlementEmpRow('branch-B', []));

    const fd = new FormData();
    fd.append('granted', '10');
    fd.append('carryover', '0');
    fd.append('adjustment', '0');

    await expect(upsertEntitlement('e1', 'lt-1', 2025, fd)).rejects.toThrow('NOT_FOUND');
    expect(leaveEntitlementUpsert).not.toHaveBeenCalled();
  });

  it('allows a scoped actor (A) on a rotating employee home=B assigned=[A]', async () => {
    getUserAssignments.mockResolvedValue(scopedAssignments('branch-A', 'leave.entitlement.manage'));
    empFindUnique.mockResolvedValue(entitlementEmpRow('branch-B', ['branch-A']));

    const fd = new FormData();
    fd.append('granted', '10');
    fd.append('carryover', '0');
    fd.append('adjustment', '0');

    await upsertEntitlement('e1', 'lt-1', 2025, fd).catch(() => {});
    expect(leaveEntitlementUpsert).toHaveBeenCalled();
  });

  it('allows a global actor on any employee', async () => {
    getUserAssignments.mockResolvedValue(globalAssignments('leave.entitlement.manage'));
    empFindUnique.mockResolvedValue(entitlementEmpRow('branch-Z', []));

    const fd = new FormData();
    fd.append('granted', '5');
    fd.append('carryover', '2');
    fd.append('adjustment', '0');

    await upsertEntitlement('e1', 'lt-1', 2025, fd).catch(() => {});
    expect(leaveEntitlementUpsert).toHaveBeenCalled();
  });
});
