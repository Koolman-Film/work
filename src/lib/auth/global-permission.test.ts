import { describe, expect, it } from 'vitest';
import { hasGlobalPermission } from './check-permission';
import type { AuthedAssignment } from './require-role';

function assignment(
  over: Partial<AuthedAssignment['role']> & { branchId?: string | null },
): AuthedAssignment {
  const { branchId = null, ...role } = over;
  return {
    branchId,
    role: {
      key: role.key ?? 'admin',
      name: role.name ?? 'Admin',
      isSuperadmin: role.isSuperadmin ?? false,
      archivedAt: role.archivedAt ?? null,
      permissions: role.permissions ?? [],
    },
  };
}

describe('hasGlobalPermission', () => {
  it('grants when a global (branchId=null) assignment includes the permission', () => {
    const a = [assignment({ branchId: null, permissions: ['audit.read'] })];
    expect(hasGlobalPermission(a, 'audit.read')).toBe(true);
  });
  it('grants a superadmin regardless of permission list', () => {
    const a = [assignment({ branchId: null, isSuperadmin: true, permissions: [] })];
    expect(hasGlobalPermission(a, 'audit.read')).toBe(true);
  });
  it('denies when the permission is only branch-scoped', () => {
    const a = [assignment({ branchId: 'branch-uuid', permissions: ['audit.read'] })];
    expect(hasGlobalPermission(a, 'audit.read')).toBe(false);
  });
  it('denies when no assignment includes the permission', () => {
    const a = [assignment({ branchId: null, permissions: ['payroll.read'] })];
    expect(hasGlobalPermission(a, 'audit.read')).toBe(false);
  });
  it('denies with no assignments', () => {
    expect(hasGlobalPermission([], 'audit.read')).toBe(false);
  });
});
