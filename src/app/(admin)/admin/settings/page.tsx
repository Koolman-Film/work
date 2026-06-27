import { redirect } from 'next/navigation';
import { requireAdminArea } from '@/lib/auth/admin-area';
import type { Permission } from '@/lib/auth/permissions';

/**
 * /admin/settings → redirect to the first settings section the user can access.
 *
 * Custom-role users may only hold a subset of settings permissions, so we
 * check their permission set and send them to the first section they are
 * allowed into. If they hold none of the known sections, they go back to
 * /admin (requireAdminArea already ensures they are at least in the back
 * office, so /admin is safe).
 */

const SECTIONS: ReadonlyArray<{ href: string; permission: Permission }> = [
  { href: '/admin/settings/branches', permission: 'settings.branch.manage' },
  { href: '/admin/settings/departments', permission: 'settings.department.manage' },
  { href: '/admin/settings/accounting-groups', permission: 'settings.accounting-group.manage' },
  { href: '/admin/settings/leave-types', permission: 'settings.leave-type.manage' },
  { href: '/admin/settings/leave-config', permission: 'settings.leave-config.manage' },
  { href: '/admin/settings/holidays', permission: 'settings.holiday.manage' },
  { href: '/admin/settings/work-schedules', permission: 'settings.work-schedule.manage' },
  { href: '/admin/settings/attendance', permission: 'settings.attendance.manage' },
  { href: '/admin/settings/team', permission: 'team.read' },
  { href: '/admin/settings/roles', permission: 'role.read' },
];

export default async function SettingsIndexPage() {
  const { permissions } = await requireAdminArea();
  const first = SECTIONS.find((s) => permissions.has(s.permission));
  redirect(first ? first.href : '/admin');
}
