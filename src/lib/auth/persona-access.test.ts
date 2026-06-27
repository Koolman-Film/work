/**
 * Persona access matrix — regression guard for the "custom roles confer
 * admin access" change. Proves the two questions that matter:
 *
 *   1. Superadmin and Admin are UNAFFECTED — they still reach everything
 *      they reached before (Superadmin: all; Admin: all except the
 *      Superadmin-only role catalog).
 *   2. A new custom role (Checker01) works as expected — admitted to the
 *      back office, can use the pages its permissions cover, denied the
 *      rest.
 *
 * Drives the REAL decision functions (no mocks of the policy), with Admin/
 * Staff fixtures built from the actual seed (SYSTEM_ROLES), so the test
 * tracks the source of truth.
 */

import { describe, expect, it } from 'vitest';
import { hasAdminAreaAccess } from './admin-area';
import { checkAssignments, permissionsFromAssignments } from './check-permission';
import { ALL_PERMISSIONS, type Permission } from './permissions';
import { SYSTEM_ROLES } from './roles';
import { canManageSystemRole } from './team-guards';
import { computeTier } from './user-tier';

type Assignment = {
  branchId: string | null;
  role: {
    key: string;
    isSuperadmin: boolean;
    archivedAt: Date | null;
    permissions: ReadonlyArray<Permission>;
  };
};

const assign = (
  key: string,
  isSuperadmin: boolean,
  permissions: ReadonlyArray<Permission>,
): Assignment => ({ branchId: null, role: { key, isSuperadmin, archivedAt: null, permissions } });

// Global (branchId=null) assignments, one role each.
const SUPERADMIN = [assign('superadmin', true, SYSTEM_ROLES.superadmin.permissions)];
const ADMIN = [assign('admin', false, SYSTEM_ROLES.admin.permissions)];
const STAFF = [assign('staff', false, SYSTEM_ROLES.staff.permissions)];
// The bug report's role: oversee check-in/out only.
const CHECKER01 = [assign('checker01', false, ['attendance.read', 'attendance.dispute-resolve'])];

const can = (a: Assignment[], p: Permission) => checkAssignments(a, p);
const admitted = (a: Assignment[]) =>
  hasAdminAreaAccess(permissionsFromAssignments(a), computeTier(a));

/**
 * Every permission used to gate an /admin page or section layout, paired
 * with whether the system Admin role is expected to hold it. Mirrors the
 * gate audit of src/app/(admin)/admin/**. `role.manage` is Superadmin-only
 * by design (Admin can read the role catalog, not edit it).
 */
const PAGE_GATES: ReadonlyArray<Permission> = [
  'dashboard.read', // /admin, /admin/calendar
  'attendance.read', // /admin/attendance, /admin/attendance/disputed
  'attendance.live-board',
  'attendance.manual-create',
  'attendance.overtime.manage',
  'leave.read', // /admin/leave
  'leave.approve', // /admin/leave/new
  'advance.read', // /admin/advance
  'advance.approve', // /admin/advance/new
  'employee.read', // /admin/employees, /admin/employees/[id]/edit
  'employee.create', // /admin/employees/new
  'report.read', // /admin/reports/* (layout)
  'payroll.read', // /admin/payroll/* (layout)
  'payroll.publish', // /admin/tools/recompute-leave
  'settings.branch.manage',
  'settings.department.manage',
  'settings.accounting-group.manage',
  'settings.leave-type.manage',
  'settings.leave-config.manage',
  'settings.holiday.manage',
  'settings.work-schedule.manage',
  'settings.attendance.manage',
  'team.read', // /admin/settings/team
  'team.create', // /admin/settings/team/new
  'team.update', // /admin/settings/team/[id]/edit
  'role.read', // /admin/settings/roles
  'role.manage', // /admin/settings/roles/new + [id]/edit — Superadmin only
];

describe('Persona access matrix', () => {
  describe('admission to /admin (unchanged for system tiers)', () => {
    it('Superadmin is admitted, tier=Superadmin', () => {
      expect(computeTier(SUPERADMIN)).toBe('Superadmin');
      expect(admitted(SUPERADMIN)).toBe(true);
    });
    it('Admin is admitted, tier=Admin', () => {
      expect(computeTier(ADMIN)).toBe('Admin');
      expect(admitted(ADMIN)).toBe(true);
    });
    it('pure Staff is NOT admitted (tier=Staff)', () => {
      expect(computeTier(STAFF)).toBe('Staff');
      expect(admitted(STAFF)).toBe(false);
    });
    it('new custom role Checker01 IS admitted, tier=null', () => {
      expect(computeTier(CHECKER01)).toBeNull();
      expect(admitted(CHECKER01)).toBe(true);
    });
  });

  describe('Superadmin is unaffected — reaches EVERY page', () => {
    it.each(ALL_PERMISSIONS)('grants %s via isSuperadmin bypass', (p) => {
      expect(can(SUPERADMIN, p)).toBe(true);
    });
  });

  describe('Admin is unaffected — reaches every page except the Superadmin-only role catalog', () => {
    it.each(PAGE_GATES)('gate %s matches Admin seed (only role.manage denied)', (p) => {
      expect(can(ADMIN, p)).toBe(p !== 'role.manage');
    });
  });

  describe('Checker01 works as expected — only its permitted pages', () => {
    it('can access the attendance pages it was granted', () => {
      expect(can(CHECKER01, 'attendance.read')).toBe(true);
      expect(can(CHECKER01, 'attendance.dispute-resolve')).toBe(true);
    });
    it('is denied every page it was NOT granted', () => {
      for (const p of [
        'employee.read',
        'payroll.read',
        'leave.read',
        'advance.read',
        'dashboard.read',
        'report.read',
        'settings.branch.manage',
        'team.read',
        'role.read',
      ] as Permission[]) {
        expect(can(CHECKER01, p)).toBe(false);
      }
    });
  });

  describe('privilege-escalation guard (new) does not touch system tiers', () => {
    const systemRole = { isSystem: true };
    const customRole = { isSystem: false };
    it('Admin/Superadmin can still grant/remove system roles', () => {
      expect(canManageSystemRole('Superadmin', systemRole)).toBe(true);
      expect(canManageSystemRole('Admin', systemRole)).toBe(true);
    });
    it('tier-less (custom) and Staff actors cannot mint system roles', () => {
      expect(canManageSystemRole(null, systemRole)).toBe(false);
      expect(canManageSystemRole('Staff', systemRole)).toBe(false);
    });
    it('custom-role assignment stays open to everyone with role.assign', () => {
      expect(canManageSystemRole(null, customRole)).toBe(true);
      expect(canManageSystemRole('Admin', customRole)).toBe(true);
    });
  });
});
