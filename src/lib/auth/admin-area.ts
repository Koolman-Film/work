// src/lib/auth/admin-area.ts
import type { Role, User } from '@prisma/client';
import { notFound } from 'next/navigation';
import { permissionsFromAssignments } from './check-permission';
import type { Permission } from './permissions';
import { resolveAuthedUser } from './require-role';
import { computeTier } from './user-tier';

/**
 * Permissions that a Staff/LIFF self-service user may hold which do NOT
 * by themselves justify access to the /admin back office. Anything
 * OUTSIDE this set is a back-office capability.
 */
export const STAFF_SELF_SERVICE_PERMISSIONS: ReadonlySet<Permission> = new Set([
  'liff.check-in',
  'liff.leave-submit',
  'liff.advance-submit',
  'liff.profile-edit',
]);

/**
 * Does this user belong in the /admin back office?
 *
 * Trade-off you're deciding: a *blacklist* (any perm outside the staff
 * self-service set) auto-includes future admin permissions without
 * edits — but mis-classifying a new staff-only perm would leak access.
 * A *whitelist* is safer but needs maintenance. We default to blacklist
 * because the staff set is tiny, closed, and unlikely to grow.
 */
export function hasAdminAreaAccess(
  permissions: ReadonlySet<Permission>,
  tier: Role | null,
): boolean {
  if (tier === 'Admin' || tier === 'Superadmin') return true;
  for (const p of permissions) {
    if (!STAFF_SELF_SERVICE_PERMISSIONS.has(p)) return true;
  }
  return false;
}

/**
 * Back-office admission gate. Admits Admin/Superadmin tiers AND custom
 * roles that carry any back-office permission. notFound() otherwise.
 * Returns the permission set so the layout can drive nav visibility.
 */
export async function requireAdminArea(): Promise<{
  user: User;
  authUserId: string;
  tier: Role | null;
  permissions: Set<Permission>;
}> {
  const { user, authUserId, assignments } = await resolveAuthedUser();
  const permissions = permissionsFromAssignments(assignments);
  const tier = computeTier(assignments);
  if (!hasAdminAreaAccess(permissions, tier)) notFound();
  return { user, authUserId, tier, permissions };
}
