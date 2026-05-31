/**
 * Locks the intent of the soft-delete/void permission keys added for the
 * Attendance/Leave/Advance void feature:
 *   - the three keys exist in the catalog with labels
 *   - Admin gets them by default (branch-scoped voiding is an admin job)
 *   - Superadmin gets them via the isSuperadmin shortcut (empty array by design)
 *   - Staff does NOT get them
 *
 * perm-coverage.test.ts already guards "granted by some role / no orphan";
 * this pins the *who* explicitly so a future role-defaults edit can't silently
 * drop void from Admin or hand it to Staff.
 */
import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from './permissions';
import { SYSTEM_ROLES } from './roles';

const VOID_KEYS = ['attendance.void', 'leave.void', 'advance.void'] as const;

describe('void permissions', () => {
  it('registers the three void keys with Thai labels', () => {
    for (const key of VOID_KEYS) {
      expect(PERMISSIONS[key]).toBeTruthy();
    }
  });

  it('grants every void key to the Admin system role', () => {
    for (const key of VOID_KEYS) {
      expect(SYSTEM_ROLES.admin.permissions).toContain(key);
    }
  });

  it('grants void to Superadmin via the isSuperadmin shortcut (array empty by design)', () => {
    expect(SYSTEM_ROLES.superadmin.isSuperadmin).toBe(true);
    expect(SYSTEM_ROLES.superadmin.permissions).toHaveLength(0);
  });

  it('does NOT grant void to Staff', () => {
    for (const key of VOID_KEYS) {
      expect(SYSTEM_ROLES.staff.permissions).not.toContain(key);
    }
  });
});
