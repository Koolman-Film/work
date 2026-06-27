// src/lib/auth/admin-area.test.ts
import { describe, expect, it } from 'vitest';
import { hasAdminAreaAccess } from './admin-area';
import type { Permission } from './permissions';

const set = (...p: Permission[]) => new Set<Permission>(p);

describe('hasAdminAreaAccess', () => {
  it('admits a custom role with an admin permission', () => {
    expect(hasAdminAreaAccess(set('attendance.read'), null)).toBe(true);
  });
  it('admits Admin/Superadmin tiers even with empty perms (defensive)', () => {
    expect(hasAdminAreaAccess(set(), 'Admin')).toBe(true);
    expect(hasAdminAreaAccess(set(), 'Superadmin')).toBe(true);
  });
  it('denies a pure staff/LIFF user', () => {
    expect(hasAdminAreaAccess(set('liff.check-in', 'liff.leave-submit'), 'Staff')).toBe(false);
  });
  it('denies a user with no permissions and no tier', () => {
    expect(hasAdminAreaAccess(set(), null)).toBe(false);
  });
});
