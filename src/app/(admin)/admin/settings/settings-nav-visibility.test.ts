import { describe, expect, it } from 'vitest';
import type { Permission } from '@/lib/auth/permissions';
import { canSeeSettingsItem } from './settings-nav-visibility';

const perms = (...p: Permission[]) => new Set<Permission>(p);

describe('canSeeSettingsItem', () => {
  describe('permission-gated entries', () => {
    it('shows an entry whose permission the user holds', () => {
      const item = { permission: 'settings.branch.manage' as Permission };
      expect(canSeeSettingsItem(item, perms('settings.branch.manage'), 'Admin')).toBe(true);
    });

    it('hides an entry whose permission the user lacks, even for a Superadmin tier', () => {
      const item = { permission: 'settings.payroll.manage' as Permission };
      expect(canSeeSettingsItem(item, perms('role.read'), 'Superadmin')).toBe(false);
    });
  });

  describe('self-service entries (permission: null)', () => {
    // The regression: prod's `admin` role does not carry `team.read`, so gating
    // the LINE link on it hid the page from every non-superadmin admin — even
    // though /admin/settings/line itself only requires Admin *tier*.
    it('shows a self-service entry to an Admin who lacks team.read', () => {
      const item = { permission: null };
      expect(canSeeSettingsItem(item, perms('role.read', 'dashboard.read'), 'Admin')).toBe(true);
    });

    it('shows a self-service entry to a Superadmin', () => {
      const item = { permission: null };
      expect(canSeeSettingsItem(item, perms(), 'Superadmin')).toBe(true);
    });

    // requireAdminArea() admits custom-role users with any back-office
    // permission, but requireRole(['Admin']) would 404 them on the page —
    // so the link must not appear.
    it('hides a self-service entry from a back-office custom role with no tier', () => {
      const item = { permission: null };
      expect(canSeeSettingsItem(item, perms('report.read'), null)).toBe(false);
    });

    it('hides a self-service entry from Staff tier', () => {
      const item = { permission: null };
      expect(canSeeSettingsItem(item, perms('liff.check-in'), 'Staff')).toBe(false);
    });
  });
});
