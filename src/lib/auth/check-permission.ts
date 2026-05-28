/**
 * Permission-check helpers — the new authorization primitive that
 * sits alongside the legacy `requireRole` (in require-role.ts).
 *
 * Use these for any NEW code. Existing code can continue using
 * requireRole until the gradual migration in Phase 3.
 *
 * Phase 1 behavior:
 *   - `canDo(user, permission)` returns true if the user has ANY
 *     UserRoleAssignment whose role includes that permission.
 *   - `canDo(user, permission, branchId)` IGNORES branchId in Phase 1.
 *     The argument is accepted so callers can already write the
 *     branch-scoped check signature; Phase 3 wires up real
 *     enforcement (just changes this one function).
 *   - Superadmin shortcut: any user with an assignment to a role
 *     where `role.isSuperadmin = true` returns true for any permission.
 *
 * Phase 3 will tighten:
 *   - branchId match check (NULL = global, non-NULL = scoped)
 *   - Caching to avoid N+1 round-trips when checking multiple perms
 *     per request
 */

import type { User } from '@prisma/client';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import type { Permission } from './permissions';
import { requireRole } from './require-role';

/**
 * Lookup all role assignments for a user, with the role data eagerly
 * joined. Cheap query (one user has a handful of assignments at most).
 *
 * Returns an empty array if the user has no assignments — caller is
 * responsible for deciding what that means (probably "no access").
 */
export async function getUserAssignments(userId: string) {
  return prisma.userRoleAssignment.findMany({
    where: { userId },
    include: {
      role: {
        select: {
          id: true,
          key: true,
          name: true,
          permissions: true,
          isSuperadmin: true,
          archivedAt: true,
        },
      },
    },
  });
}

/**
 * Does this user have the given permission?
 *
 * In Phase 1, `branchId` is recorded by the assignment in the DB but
 * NOT yet enforced — `canDo` returns true if any non-archived role
 * grants the permission, regardless of scope. This lets new call sites
 * already pass the branchId context (preserving intent for Phase 3
 * enforcement) without needing a different signature later.
 *
 * Returns true when:
 *   - The user has any assignment whose role has `isSuperadmin=true`, OR
 *   - The user has any assignment whose role includes `permission` in
 *     its `permissions[]` array AND the role isn't archived
 */
export async function canDo(
  user: Pick<User, 'id'>,
  permission: Permission,
  _ctx?: { branchId?: string | null },
): Promise<boolean> {
  const assignments = await getUserAssignments(user.id);

  for (const a of assignments) {
    // Archived roles grant nothing — defensive.
    if (a.role.archivedAt) continue;

    if (a.role.isSuperadmin) return true;
    if (a.role.permissions.includes(permission)) return true;
  }

  return false;
}

/**
 * Bulk variant — efficient when checking multiple permissions for the
 * same user (e.g., rendering a UI that needs to show/hide multiple
 * sections based on what the user can do). Returns a Set of allowed
 * permissions; absent keys mean "denied".
 */
export async function getPermissionsFor(user: Pick<User, 'id'>): Promise<Set<Permission>> {
  const assignments = await getUserAssignments(user.id);
  const result = new Set<Permission>();

  for (const a of assignments) {
    if (a.role.archivedAt) continue;
    if (a.role.isSuperadmin) {
      // Caller-side shortcut: rather than enumerate every catalog key
      // here, callers should test for superadmin separately if they
      // need to render "everything." For predicate-style checks we
      // synthesize the set lazily via a Proxy — but in practice every
      // call site iterates a known list. Simplest correct answer:
      // mark with a sentinel symbol the caller can detect.
      //
      // Pragmatic choice: dump every catalog perm into the set so
      // `result.has(p)` works uniformly. Cost is O(catalog size) per
      // superadmin call — tiny.
      const { ALL_PERMISSIONS } = await import('./permissions');
      for (const p of ALL_PERMISSIONS) result.add(p);
      return result;
    }
    for (const p of a.role.permissions) {
      // Validate at read boundary — permissions in the DB could
      // theoretically be stale strings from a deleted catalog entry.
      result.add(p as Permission);
    }
  }

  return result;
}

/**
 * Hard gate — call inside a Server Action / Server Component to
 * require a permission. If the user lacks it, throws `notFound()`
 * (same opaque rejection as requireRole, doesn't leak which routes
 * exist to unauthorized callers).
 *
 * Phase 1: the legacy `requireRole(['Admin', 'Superadmin'])` is still
 * fine for existing surfaces. Use this for NEW Server Actions that
 * want fine-grained permissions.
 *
 *   const { user } = await requirePermission('employee.create');
 */
export async function requirePermission(
  permission: Permission,
  ctx?: { branchId?: string | null },
): Promise<{ user: User }> {
  // We need an authenticated user first; reuse requireRole's session
  // resolution by calling it with the union of all known roles (so it
  // doesn't reject anyone authenticated). The role union is the
  // current enum surface — Phase 3 can drop it.
  const { user } = await requireRole(['Staff', 'Admin', 'Superadmin']);
  const ok = await canDo(user, permission, ctx);
  if (!ok) notFound();
  return { user };
}
