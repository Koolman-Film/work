import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  isPermission,
  PERMISSION_GROUPS,
  PERMISSIONS,
  type Permission,
} from './permissions';
import { SYSTEM_ROLES } from './roles';

const CATALOG = new Set<string>(Object.keys(PERMISSIONS));

describe('PERMISSIONS catalog', () => {
  it('ALL_PERMISSIONS mirrors the catalog keys', () => {
    expect([...ALL_PERMISSIONS].sort()).toEqual(Object.keys(PERMISSIONS).sort());
  });
  it('isPermission narrows real keys and rejects junk', () => {
    expect(isPermission('payroll.run')).toBe(true);
    expect(isPermission('settings.attendance.manage')).toBe(true);
    expect(isPermission('nope.fake')).toBe(false);
    expect(isPermission(123)).toBe(false);
    expect(isPermission(undefined)).toBe(false);
  });
});

describe('PERMISSION_GROUPS', () => {
  it('only reference real permission keys', () => {
    for (const g of PERMISSION_GROUPS) {
      for (const p of g.permissions) {
        expect(CATALOG.has(p), `group "${g.key}" lists unknown permission "${p}"`).toBe(true);
      }
    }
  });
  it('have no duplicate permission across groups', () => {
    const all = PERMISSION_GROUPS.flatMap((g) => g.permissions);
    expect(new Set(all).size).toBe(all.length);
  });
  it('cover every catalog permission (none orphaned from the roles UI)', () => {
    const grouped = new Set<string>(PERMISSION_GROUPS.flatMap((g) => g.permissions));
    const missing = [...CATALOG].filter((p) => !grouped.has(p));
    expect(missing, `ungrouped permissions: ${missing.join(', ')}`).toEqual([]);
  });
});

describe('SYSTEM_ROLES', () => {
  const roles = Object.values(SYSTEM_ROLES);

  it('grant only real permissions, with no duplicates', () => {
    for (const r of roles) {
      for (const p of r.permissions) {
        expect(CATALOG.has(p), `role "${r.key}" grants unknown permission "${p}"`).toBe(true);
      }
      expect(new Set(r.permissions).size, `role "${r.key}" has duplicate permissions`).toBe(
        r.permissions.length,
      );
    }
  });

  it('reserve isSuperadmin for the superadmin role only', () => {
    expect(SYSTEM_ROLES.superadmin.isSuperadmin).toBe(true);
    expect(SYSTEM_ROLES.admin.isSuperadmin).toBe(false);
    expect(SYSTEM_ROLES.staff.isSuperadmin).toBe(false);
  });

  it('give admin broad (but not super) access and staff a minimal set', () => {
    expect(SYSTEM_ROLES.admin.permissions.length).toBeGreaterThan(10);
    expect(SYSTEM_ROLES.admin.permissions as ReadonlyArray<Permission>).toContain('payroll.run');
    // Staff should never hold an admin-only payroll/settings permission.
    expect(SYSTEM_ROLES.staff.permissions as ReadonlyArray<string>).not.toContain('payroll.run');
  });
});
