/**
 * Unit tests for the pure team-guard policy.
 *
 * `canActOnRole` is trivial — covered with a small matrix. The
 * interesting work is in `checkUserScope`, where the asymmetry around
 * "target has a global assignment" needs explicit pinning.
 */

import { describe, expect, it } from 'vitest';
import {
  canActOnRole,
  canManageSystemRole,
  checkUserScope,
  payrollRoleBranchScopeError,
  type ScopeAssignment,
  systemRoleGrantError,
} from './team-guards';

describe('canActOnRole with null actor', () => {
  it('a tier-less (custom-only) actor cannot act on any tier', () => {
    expect(canActOnRole(null, 'Admin')).toBe(false);
    expect(canActOnRole(null, 'Superadmin')).toBe(false);
  });
  it('existing behaviour preserved', () => {
    expect(canActOnRole('Superadmin', 'Superadmin')).toBe(true);
    expect(canActOnRole('Admin', 'Admin')).toBe(true);
    expect(canActOnRole('Admin', 'Superadmin')).toBe(false);
  });
});

const BRANCH_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const BRANCH_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function admin(branchId: string | null): ScopeAssignment {
  return { branchId, role: { archivedAt: null, isSuperadmin: false } };
}
function superadmin(branchId: string | null): ScopeAssignment {
  return { branchId, role: { archivedAt: null, isSuperadmin: true } };
}
function archivedAdmin(branchId: string | null): ScopeAssignment {
  return { branchId, role: { archivedAt: new Date('2026-01-01'), isSuperadmin: false } };
}

describe('canActOnRole (tier guard)', () => {
  it('Superadmin can act on anyone', () => {
    expect(canActOnRole('Superadmin', 'Superadmin')).toBe(true);
    expect(canActOnRole('Superadmin', 'Admin')).toBe(true);
    expect(canActOnRole('Superadmin', 'Staff')).toBe(true);
  });

  it('Admin can act on Admin only', () => {
    expect(canActOnRole('Admin', 'Admin')).toBe(true);
    expect(canActOnRole('Admin', 'Superadmin')).toBe(false);
    expect(canActOnRole('Admin', 'Staff')).toBe(false);
  });

  it('Staff cannot act on anyone', () => {
    expect(canActOnRole('Staff', 'Staff')).toBe(false);
    expect(canActOnRole('Staff', 'Admin')).toBe(false);
    expect(canActOnRole('Staff', 'Superadmin')).toBe(false);
  });
});

describe('checkUserScope (branch jurisdiction guard)', () => {
  describe('same-user shortcut', () => {
    it('always allows when actor is the target (self-edit)', () => {
      expect(checkUserScope([], [], true)).toBe(true);
      // Even with zero assignments on both sides.
    });
  });

  describe('Rule 1 — Superadmin actor transcends scope', () => {
    it('global Superadmin acts on anyone', () => {
      expect(checkUserScope([superadmin(null)], [admin(BRANCH_A)], false)).toBe(true);
      expect(checkUserScope([superadmin(null)], [admin(null)], false)).toBe(true);
      expect(checkUserScope([superadmin(null)], [], false)).toBe(true);
    });

    it('branch-scoped Superadmin acts on anyone (consistent with canDo)', () => {
      expect(checkUserScope([superadmin(BRANCH_A)], [admin(BRANCH_B)], false)).toBe(true);
    });

    it('archived Superadmin role does NOT grant', () => {
      const archivedSuper: ScopeAssignment = {
        branchId: null,
        role: { archivedAt: new Date('2026-01-01'), isSuperadmin: true },
      };
      expect(checkUserScope([archivedSuper], [admin(BRANCH_B)], false)).toBe(false);
    });
  });

  describe('Rule 2 — global Admin actor', () => {
    it('global Admin acts on any branch-scoped Admin', () => {
      expect(checkUserScope([admin(null)], [admin(BRANCH_A)], false)).toBe(true);
      expect(checkUserScope([admin(null)], [admin(BRANCH_B)], false)).toBe(true);
    });

    it('global Admin acts on global Admin', () => {
      expect(checkUserScope([admin(null)], [admin(null)], false)).toBe(true);
    });
  });

  describe('Rule 3 — branch-scoped Admin actor', () => {
    it('same branch → allow', () => {
      expect(checkUserScope([admin(BRANCH_A)], [admin(BRANCH_A)], false)).toBe(true);
    });

    it('different branch → DENY (the canonical Phase 3.7 case)', () => {
      // Admin at A trying to manage Admin at B → denied.
      expect(checkUserScope([admin(BRANCH_A)], [admin(BRANCH_B)], false)).toBe(false);
    });

    it('actor has branch A, target has branches {A, B} → ALLOW (overlap)', () => {
      expect(checkUserScope([admin(BRANCH_A)], [admin(BRANCH_A), admin(BRANCH_B)], false)).toBe(
        true,
      );
    });

    it('actor has branches {A, B}, target has branch C → DENY', () => {
      const BRANCH_C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
      expect(checkUserScope([admin(BRANCH_A), admin(BRANCH_B)], [admin(BRANCH_C)], false)).toBe(
        false,
      );
    });

    it('branch-only actor CANNOT manage a target with global assignment', () => {
      // Lateral privilege escalation guard: branch-A Admin shouldn't
      // be able to delete an "everywhere" Admin.
      expect(checkUserScope([admin(BRANCH_A)], [admin(null)], false)).toBe(false);
    });

    it('branch-only actor cannot manage a target with no assignments', () => {
      // New-user "claim" must go through addRoleAssignment (which has
      // its own branch-scoped permission check) — not through the
      // user-scope guard.
      expect(checkUserScope([admin(BRANCH_A)], [], false)).toBe(false);
    });
  });

  describe('canManageSystemRole (privilege-escalation guard)', () => {
    describe('custom roles (isSystem: false) — always allowed', () => {
      it('null actor can manage a custom role', () => {
        expect(canManageSystemRole(null, { isSystem: false })).toBe(true);
      });

      it('Staff actor can manage a custom role', () => {
        expect(canManageSystemRole('Staff', { isSystem: false })).toBe(true);
      });

      it('Admin actor can manage a custom role', () => {
        expect(canManageSystemRole('Admin', { isSystem: false })).toBe(true);
      });

      it('Superadmin actor can manage a custom role', () => {
        expect(canManageSystemRole('Superadmin', { isSystem: false })).toBe(true);
      });
    });

    describe('system roles (isSystem: true) — admin tier required', () => {
      it('null actor CANNOT manage a system role', () => {
        expect(canManageSystemRole(null, { isSystem: true })).toBe(false);
      });

      it('Staff actor CANNOT manage a system role', () => {
        expect(canManageSystemRole('Staff', { isSystem: true })).toBe(false);
      });

      it('Admin actor CAN manage a system role', () => {
        expect(canManageSystemRole('Admin', { isSystem: true })).toBe(true);
      });

      it('Superadmin actor CAN manage a system role', () => {
        expect(canManageSystemRole('Superadmin', { isSystem: true })).toBe(true);
      });
    });
  });

  describe('systemRoleGrantError (static grant guard)', () => {
    const sys = (isSuperadmin = false) => ({ isSuperadmin, isSystem: true });
    it('blocks non-Superadmin from granting the superadmin role', () => {
      expect(systemRoleGrantError('Admin', sys(true))).toBe(
        'ต้องเป็น Superadmin เพื่อมอบบทบาท Superadmin',
      );
    });
    it('blocks tier-less/Staff from granting a system role', () => {
      expect(systemRoleGrantError(null, sys())).toBe('ต้องมีสิทธิ์ระดับผู้ดูแลเพื่อมอบบทบาทระบบ');
      expect(systemRoleGrantError('Staff', sys())).toBe('ต้องมีสิทธิ์ระดับผู้ดูแลเพื่อมอบบทบาทระบบ');
    });
    it('allows Admin/Superadmin to grant a system role; anyone to grant a custom role', () => {
      expect(systemRoleGrantError('Admin', sys())).toBeNull();
      expect(systemRoleGrantError('Superadmin', sys(true))).toBeNull();
      expect(systemRoleGrantError(null, { isSuperadmin: false, isSystem: false })).toBeNull();
    });
  });

  describe('archived roles are ignored', () => {
    it("actor's archived assignment doesn't count toward scope set", () => {
      // Actor's only active assignment is archivedAdmin@A → effectively
      // no active assignments. They can't act on target@A.
      expect(checkUserScope([archivedAdmin(BRANCH_A)], [admin(BRANCH_A)], false)).toBe(false);
    });

    it("target's archived assignment doesn't count toward scope set", () => {
      // Target's only "global" assignment is archived, so it's not
      // a real global target. Actor@A still can't manage them because
      // no active branch overlap.
      expect(checkUserScope([admin(BRANCH_A)], [archivedAdmin(null)], false)).toBe(false);
    });

    it('archived target global is ignored, real overlap wins', () => {
      // Target has [archived global, active branch A]. Active overlap.
      expect(checkUserScope([admin(BRANCH_A)], [archivedAdmin(null), admin(BRANCH_A)], false)).toBe(
        true,
      );
    });
  });
});

describe('payrollRoleBranchScopeError', () => {
  const payrollRole = { permissions: ['leave.read', 'payroll.read'] };
  const plainRole = { permissions: ['leave.read', 'advance.read'] };

  it('global assignment (branchId=null) → null for any role', () => {
    expect(payrollRoleBranchScopeError(payrollRole, null)).toBeNull();
    expect(payrollRoleBranchScopeError(plainRole, null)).toBeNull();
  });

  it('branch-scoped assignment of a payroll-bearing role → error', () => {
    expect(payrollRoleBranchScopeError(payrollRole, 'b1')).toBe(
      'บทบาทที่มีสิทธิ์เงินเดือนต้องกำหนดแบบทั้งองค์กร (ไม่ระบุสาขา)',
    );
  });

  it('branch-scoped assignment of a non-payroll role → null', () => {
    expect(payrollRoleBranchScopeError(plainRole, 'b1')).toBeNull();
  });

  it('each payroll permission triggers the guard', () => {
    for (const p of ['payroll.read', 'payroll.run', 'payroll.publish', 'settings.payroll.manage']) {
      expect(payrollRoleBranchScopeError({ permissions: [p] }, 'b1')).not.toBeNull();
    }
  });
});
