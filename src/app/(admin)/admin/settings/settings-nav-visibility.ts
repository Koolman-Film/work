import type { Role } from '@prisma/client';
import type { Permission } from '@/lib/auth/permissions';

/**
 * Which settings sub-nav entries does this user get to see?
 *
 * Two kinds of entry, because the pages behind them gate two different ways:
 *
 *   - **Permission-gated** (`permission: 'settings.branch.manage'`) — the page
 *     calls requirePermission(); the link mirrors that permission.
 *   - **Self-service** (`permission: null`) — the page gates on *tier* alone
 *     (`requireRole(['Admin'])`) because it acts on the signed-in admin's own
 *     account rather than on company data. /admin/settings/line is the case:
 *     an admin binds their own LINE there.
 *
 * Keeping this a pure predicate (policy) separate from SettingsNav (the React
 * wrapper) follows the computeTier / canDo split — it makes the rule testable
 * without a DOM, which this repo's vitest setup deliberately doesn't have.
 *
 * Why the self-service branch can't just reuse a permission: it was gated on
 * `team.read` ("ดูรายการผู้ดูแล"), which the `admin` role deliberately does not
 * carry — admins are intentionally excluded from managing the admin roster. So
 * every non-superadmin admin lost the entry while the page stayed reachable by
 * URL. A link that's stricter than its own page is a dead end, not security,
 * and no team.* permission is a valid stand-in for "may I link my own LINE?".
 *
 * `requireAdminArea()` also admits custom-role users with no tier at all; they
 * must NOT see self-service entries, since requireRole(['Admin']) would 404
 * them on arrival.
 */
export function canSeeSettingsItem(
  item: { permission: Permission | null },
  allowedPermissions: ReadonlySet<Permission>,
  tier: Role | null,
): boolean {
  if (item.permission === null) return tier === 'Admin' || tier === 'Superadmin';
  return allowedPermissions.has(item.permission);
}
