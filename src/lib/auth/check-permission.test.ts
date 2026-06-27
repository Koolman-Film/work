/**
 * Unit tests for the pure policy functions in check-permission.ts.
 *
 * We exercise `checkAssignments` and `permissionsFromAssignments`
 * directly (no prisma, no mocks) — the prisma-touching wrappers
 * `canDo` and `getPermissionsFor` are trivially correct once these
 * are.
 *
 * The exhaustive table at the bottom of `checkAssignments` is the
 * documentation we wished we had when designing this. Every branch
 * of the scope-intersection rule has an explicit test.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { createClient } from '@/lib/supabase/server';
import {
  type AssignmentForCheck,
  checkAssignments,
  permissionsFromAssignments,
} from './check-permission';
import { ALL_PERMISSIONS } from './permissions';

vi.mock('@/lib/supabase/server');
vi.mock('@/lib/db/prisma', () => ({ prisma: { user: { findUnique: vi.fn() } } }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

import { requirePermission } from './check-permission';

function mockUserWith(perms: string[]) {
  (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'a1', identities: [] } } }) },
  });
  (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 'u1',
    email: 'c@x.io',
    authUserId: 'a1',
    archivedAt: null,
    employee: null,
    roleAssignments: [
      {
        branchId: null,
        role: {
          key: 'checker01',
          name: 'Checker01',
          isSuperadmin: false,
          archivedAt: null,
          permissions: perms,
        },
      },
    ],
  });
}

describe('requirePermission for a custom-only user', () => {
  beforeEach(() => vi.clearAllMocks());
  it('passes when the custom role grants the permission (tier null)', async () => {
    mockUserWith(['attendance.read']);
    const res = await requirePermission('attendance.read');
    expect(res.user.id).toBe('u1');
    expect(res.tier).toBeNull();
  });
  it('notFound() when the permission is absent', async () => {
    mockUserWith(['attendance.read']);
    await expect(requirePermission('payroll.read')).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

// Fixture branchIds — chosen to be obviously distinct in test output.
const BRANCH_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const BRANCH_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

/**
 * Fixture builder — keep tests terse by defaulting every field
 * except the one each test cares about. Role is merged separately
 * so callers can override just one field of the nested object.
 */
function assignment(overrides: Partial<AssignmentForCheck> = {}): AssignmentForCheck {
  const { role: roleOverrides, ...rest } = overrides;
  return {
    branchId: null,
    ...rest,
    role: {
      permissions: [],
      isSuperadmin: false,
      archivedAt: null,
      ...(roleOverrides ?? {}),
    },
  };
}

describe('checkAssignments', () => {
  describe('empty cases', () => {
    it('returns false when user has no assignments', () => {
      expect(checkAssignments([], 'employee.update')).toBe(false);
    });

    it('returns false when assignments have empty permission lists', () => {
      const a = assignment({ role: { permissions: [], isSuperadmin: false, archivedAt: null } });
      expect(checkAssignments([a], 'employee.update')).toBe(false);
    });
  });

  describe('Superadmin shortcut', () => {
    it('global Superadmin grants any permission, no ctx', () => {
      const a = assignment({
        branchId: null,
        role: { permissions: [], isSuperadmin: true, archivedAt: null },
      });
      // Sample a few — the contract is "all".
      expect(checkAssignments([a], 'employee.delete')).toBe(true);
      expect(checkAssignments([a], 'role.manage')).toBe(true);
      expect(checkAssignments([a], 'liff.check-in')).toBe(true);
    });

    it('global Superadmin grants any permission for any branch ctx', () => {
      const a = assignment({
        branchId: null,
        role: { permissions: [], isSuperadmin: true, archivedAt: null },
      });
      expect(checkAssignments([a], 'employee.update', { branchId: BRANCH_A })).toBe(true);
      expect(checkAssignments([a], 'employee.update', { branchId: BRANCH_B })).toBe(true);
    });

    it('branch-scoped Superadmin grants only at matching branch', () => {
      const a = assignment({
        branchId: BRANCH_A,
        role: { permissions: [], isSuperadmin: true, archivedAt: null },
      });
      expect(checkAssignments([a], 'role.manage', { branchId: BRANCH_A })).toBe(true);
      expect(checkAssignments([a], 'role.manage', { branchId: BRANCH_B })).toBe(false);
    });

    it('branch-scoped Superadmin grants when caller has no branch ctx', () => {
      // "Can this user do X anywhere?" → yes, at their branch.
      const a = assignment({
        branchId: BRANCH_A,
        role: { permissions: [], isSuperadmin: true, archivedAt: null },
      });
      expect(checkAssignments([a], 'role.manage')).toBe(true);
    });
  });

  describe('archived roles', () => {
    it('skips archived roles even if permission matches', () => {
      const a = assignment({
        role: {
          permissions: ['employee.update'],
          isSuperadmin: false,
          archivedAt: new Date('2026-01-01'),
        },
      });
      expect(checkAssignments([a], 'employee.update')).toBe(false);
    });

    it('skips archived Superadmin role (defensive)', () => {
      const a = assignment({
        role: { permissions: [], isSuperadmin: true, archivedAt: new Date('2026-01-01') },
      });
      expect(checkAssignments([a], 'employee.delete')).toBe(false);
    });
  });

  describe('permission membership', () => {
    it('grants when role lists the permission', () => {
      const a = assignment({
        role: {
          permissions: ['employee.update', 'employee.read'],
          isSuperadmin: false,
          archivedAt: null,
        },
      });
      expect(checkAssignments([a], 'employee.update')).toBe(true);
      expect(checkAssignments([a], 'employee.read')).toBe(true);
    });

    it('denies when permission is absent from the role', () => {
      const a = assignment({
        role: { permissions: ['employee.read'], isSuperadmin: false, archivedAt: null },
      });
      expect(checkAssignments([a], 'employee.update')).toBe(false);
    });
  });

  describe('branch-scope intersection (the Phase 3 enforcement)', () => {
    const adminPerms = {
      permissions: ['employee.update'] as ReadonlyArray<string>,
      isSuperadmin: false,
      archivedAt: null as Date | null,
    };

    it('global assignment grants for any caller branch', () => {
      const a = assignment({ branchId: null, role: adminPerms });
      expect(checkAssignments([a], 'employee.update', { branchId: BRANCH_A })).toBe(true);
      expect(checkAssignments([a], 'employee.update', { branchId: BRANCH_B })).toBe(true);
      expect(checkAssignments([a], 'employee.update')).toBe(true);
    });

    it('scoped assignment grants when caller branch matches', () => {
      const a = assignment({ branchId: BRANCH_A, role: adminPerms });
      expect(checkAssignments([a], 'employee.update', { branchId: BRANCH_A })).toBe(true);
    });

    it('scoped assignment DENIES when caller branch differs (the canonical Phase 3 case)', () => {
      // Branch A admin tries to edit branch B employee → false.
      // This is the test the user specifically called out.
      const a = assignment({ branchId: BRANCH_A, role: adminPerms });
      expect(checkAssignments([a], 'employee.update', { branchId: BRANCH_B })).toBe(false);
    });

    it('scoped assignment grants when caller passes no ctx (Phase 1 compat)', () => {
      // Existing non-migrated callsites don't pass branchId yet.
      // They should still work — "can you do this anywhere?" yes.
      const a = assignment({ branchId: BRANCH_A, role: adminPerms });
      expect(checkAssignments([a], 'employee.update')).toBe(true);
      // Explicit null is treated the same as omitted.
      expect(checkAssignments([a], 'employee.update', { branchId: null })).toBe(true);
    });
  });

  describe('multiple assignments (the multi-branch user)', () => {
    const adminPerms = {
      permissions: ['employee.update'] as ReadonlyArray<string>,
      isSuperadmin: false,
      archivedAt: null as Date | null,
    };

    it('grants when ANY assignment matches scope+permission', () => {
      // User is admin at branch A AND staff at branch B.
      // Asking about employee.update at branch A → granted by first
      // assignment.
      const a1 = assignment({ branchId: BRANCH_A, role: adminPerms });
      const a2 = assignment({
        branchId: BRANCH_B,
        role: { permissions: ['liff.check-in'], isSuperadmin: false, archivedAt: null },
      });
      expect(checkAssignments([a1, a2], 'employee.update', { branchId: BRANCH_A })).toBe(true);
    });

    it('grants when ONE of multiple branch-scoped admin roles matches', () => {
      // User is admin at both A and B (two separate assignments).
      // Either branch query should pass.
      const aA = assignment({ branchId: BRANCH_A, role: adminPerms });
      const aB = assignment({ branchId: BRANCH_B, role: adminPerms });
      expect(checkAssignments([aA, aB], 'employee.update', { branchId: BRANCH_A })).toBe(true);
      expect(checkAssignments([aA, aB], 'employee.update', { branchId: BRANCH_B })).toBe(true);
    });

    it('denies when ALL matching-permission assignments are scoped to OTHER branches', () => {
      // Admin at A only, asking about B → denied even though they
      // technically have employee.update *somewhere*.
      const a = assignment({ branchId: BRANCH_A, role: adminPerms });
      expect(checkAssignments([a], 'employee.update', { branchId: BRANCH_B })).toBe(false);
    });
  });
});

describe('permissionsFromAssignments', () => {
  it('returns empty set for empty input', () => {
    expect(permissionsFromAssignments([])).toEqual(new Set());
  });

  it('returns the union of permissions across all in-scope assignments', () => {
    const a1 = {
      branchId: null,
      role: {
        permissions: ['employee.read', 'employee.update'],
        isSuperadmin: false,
        archivedAt: null,
      },
    };
    const a2 = {
      branchId: null,
      role: { permissions: ['leave.approve'], isSuperadmin: false, archivedAt: null },
    };
    const result = permissionsFromAssignments([a1, a2]);
    expect(result.has('employee.read')).toBe(true);
    expect(result.has('employee.update')).toBe(true);
    expect(result.has('leave.approve')).toBe(true);
    expect(result.has('role.manage')).toBe(false);
  });

  it('Superadmin yields every catalog permission', () => {
    const a = {
      branchId: null,
      role: { permissions: [], isSuperadmin: true, archivedAt: null },
    };
    const result = permissionsFromAssignments([a]);
    for (const p of ALL_PERMISSIONS) {
      expect(result.has(p)).toBe(true);
    }
  });

  it('filters by branch when ctx.branchId is passed', () => {
    // Admin at A with employee.update, plus a different admin at B
    // with leave.approve. Filtering by A should only return the A
    // permissions.
    const aA = {
      branchId: BRANCH_A,
      role: {
        permissions: ['employee.update'],
        isSuperadmin: false,
        archivedAt: null,
      },
    };
    const aB = {
      branchId: BRANCH_B,
      role: { permissions: ['leave.approve'], isSuperadmin: false, archivedAt: null },
    };
    const result = permissionsFromAssignments([aA, aB], { branchId: BRANCH_A });
    expect(result.has('employee.update')).toBe(true);
    expect(result.has('leave.approve')).toBe(false);
  });

  it('skips archived roles', () => {
    const a = {
      branchId: null,
      role: {
        permissions: ['employee.update'],
        isSuperadmin: false,
        archivedAt: new Date('2026-01-01'),
      },
    };
    expect(permissionsFromAssignments([a]).size).toBe(0);
  });
});
