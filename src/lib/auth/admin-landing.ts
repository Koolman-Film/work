import type { Permission } from './permissions';

/**
 * First admin path the user can actually open, in sidebar order. Used so a
 * permission-only admin (e.g. a custom role without dashboard.read) lands on a
 * real page instead of /admin's 404. Returns '/admin' only when the user holds
 * dashboard.read (or as a defensive fallback for an empty set, which
 * requireAdminArea already prevents from reaching here).
 */
const LANDING_ORDER: ReadonlyArray<readonly [Permission, string]> = [
  ['dashboard.read', '/admin'],
  ['attendance.read', '/admin/attendance'],
  ['attendance.live-board', '/admin/attendance/live'],
  ['leave.read', '/admin/leave'],
  ['advance.read', '/admin/advance'],
  ['employee.read', '/admin/employees'],
  ['report.read', '/admin/reports'],
  ['payroll.read', '/admin/payroll'],
  ['settings.branch.manage', '/admin/settings/branches'],
  ['settings.department.manage', '/admin/settings/departments'],
  ['settings.accounting-group.manage', '/admin/settings/accounting-groups'],
  ['settings.leave-type.manage', '/admin/settings/leave-types'],
  ['settings.leave-config.manage', '/admin/settings/leave-config'],
  ['settings.holiday.manage', '/admin/settings/holidays'],
  ['settings.work-schedule.manage', '/admin/settings/work-schedules'],
  ['settings.attendance.manage', '/admin/settings/attendance'],
  ['team.read', '/admin/settings/team'],
  ['role.read', '/admin/settings/roles'],
];

export function firstAccessibleAdminPath(permissions: ReadonlySet<Permission>): string {
  for (const [perm, path] of LANDING_ORDER) {
    if (permissions.has(perm)) return path;
  }
  return '/admin';
}
