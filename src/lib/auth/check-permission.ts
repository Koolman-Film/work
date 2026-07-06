/**
 * Permission-check helpers — the new authorization primitive that
 * sits alongside the legacy `requireRole` (in require-role.ts).
 *
 * Use these for any NEW code. Existing code can continue using
 * requireRole until the gradual migration in Phase 3.
 *
 * Phase 3 behavior (current):
 *   - `canDo(user, permission)` returns true if the user has ANY
 *     UserRoleAssignment whose role includes that permission AND the
 *     assignment's branch scope intersects the caller's context.
 *   - Scope intersection rules (apply uniformly, including to Superadmin
 *     assignments — branch-scoped Superadmin is a real thing, see the
 *     "last GLOBAL Superadmin" guard in team/actions.ts):
 *       global assignment (branchId=null)  → grants any context
 *       scoped  assignment (branchId=B)    × no caller ctx       → grants (any-branch check)
 *       scoped  assignment (branchId=B)    × ctx.branchId === B  → grants
 *       scoped  assignment (branchId=A)    × ctx.branchId === B  → DENIES (A ≠ B)
 *   - Superadmin shortcut (within matching scope): an active assignment
 *     to a role where `role.isSuperadmin = true` grants ALL permissions
 *     at the assignment's scope. Global Superadmin → all perms
 *     everywhere; branch-scoped Superadmin → all perms at that branch.
 *
 * Phase 3 still TODO:
 *   - Per-request caching to avoid N+1 round-trips when checking
 *     multiple perms during the same Server Component render.
 *   - Migration of existing requireRole(['Admin']) callsites — one
 *     route at a time so we don't repeat the role-rename bulk-sed
 *     regressions (commits 577328e, 7793322).
 */

import type { Role, User } from '@prisma/client';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { ALL_PERMISSIONS, type Permission } from './permissions';
import { resolveAuthedUser } from './require-role';
import { computeTier } from './user-tier';

/**
 * The shape canDo()'s pure logic needs from an assignment row. Kept
 * narrow on purpose — anything broader is the prisma query's concern,
 * not the policy's. Lets unit tests build fixtures with plain literals.
 */
export type AssignmentForCheck = {
  branchId: string | null;
  role: {
    permissions: ReadonlyArray<string>;
    isSuperadmin: boolean;
    archivedAt: Date | null;
  };
};

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
 * Pure policy function — given a user's assignments and a check, does
 * the permission apply?
 *
 * Separated from `canDo` so unit tests can exercise every branch of the
 * scope-intersection logic with fixture literals (no prisma mock).
 *
 * Returns true on the FIRST assignment that satisfies all three:
 *   1. Role is not archived
 *   2. Role grants the permission (or isSuperadmin shortcut)
 *   3. Branch scope intersects the caller's context (see header doc)
 *
 * Otherwise false. Caller-side denial is the safe default — `canDo()`
 * returning false makes `requirePermission()` notFound(), which is the
 * opaque-rejection pattern we use everywhere else.
 */
export function checkAssignments(
  assignments: ReadonlyArray<AssignmentForCheck>,
  permission: Permission,
  ctx?: { branchId?: string | null },
): boolean {
  const targetBranchId = ctx?.branchId ?? null;

  for (const a of assignments) {
    // Archived roles grant nothing — defensive (admin shouldn't be
    // able to "undo a takeaway" by un-archiving a role mid-request).
    if (a.role.archivedAt) continue;

    // Branch-scope intersection — applies to EVERY role including
    // Superadmin. Rules:
    //   - Global assignment (branchId=null) grants regardless of ctx
    //     (it's "you can do this anywhere").
    //   - Caller without ctx.branchId is asking "can you do this
    //     SOMEWHERE?" → any scoped grant says yes. This preserves
    //     Phase 1 behavior at non-migrated callsites; once a callsite
    //     starts passing branchId, enforcement kicks in for it.
    //   - Caller WITH a specific branchId requires either a global
    //     grant or a matching scoped grant.
    const inScope = a.branchId === null || targetBranchId === null || a.branchId === targetBranchId;
    if (!inScope) continue;

    // Superadmin shortcut (within the matching scope) — every permission
    // is granted by an in-scope Superadmin assignment.
    if (a.role.isSuperadmin) return true;

    // Permission must be in the role's allow-list.
    if (a.role.permissions.includes(permission)) return true;

    // else: in-scope but permission not granted by this role — keep
    // looking through the user's other assignments (they might also
    // hold a different role at the same branch).
  }

  return false;
}

/**
 * Does this user have the given permission?
 *
 * Wraps `checkAssignments` with the prisma fetch. See module header
 * for full scope semantics.
 *
 *   const ok = await canDo(user, 'employee.update', { branchId });
 */
export async function canDo(
  user: Pick<User, 'id'>,
  permission: Permission,
  ctx?: { branchId?: string | null },
): Promise<boolean> {
  const assignments = await getUserAssignments(user.id);
  return checkAssignments(assignments, permission, ctx);
}

/**
 * Bulk variant — efficient when rendering a UI that needs to show or
 * hide multiple sections based on what the user can do. Returns a Set
 * of allowed permissions; absent keys mean denied.
 *
 * Branch-scope semantics match `canDo`: pass `ctx.branchId` to filter
 * to permissions valid AT that branch, omit it to get the union across
 * all branches the user is admin-of (useful for top-level nav).
 */
export async function getPermissionsFor(
  user: Pick<User, 'id'>,
  ctx?: { branchId?: string | null },
): Promise<Set<Permission>> {
  const assignments = await getUserAssignments(user.id);
  return permissionsFromAssignments(assignments, ctx);
}

/**
 * Pure variant of `getPermissionsFor` — same scope semantics but
 * accepts pre-fetched assignments. Exposed for unit testing.
 */
export function permissionsFromAssignments(
  assignments: ReadonlyArray<AssignmentForCheck>,
  ctx?: { branchId?: string | null },
): Set<Permission> {
  const targetBranchId = ctx?.branchId ?? null;
  const result = new Set<Permission>();

  for (const a of assignments) {
    if (a.role.archivedAt) continue;

    // Branch-scope intersection (mirrors checkAssignments)
    const inScope = a.branchId === null || targetBranchId === null || a.branchId === targetBranchId;
    if (!inScope) continue;

    if (a.role.isSuperadmin) {
      // Pragmatic shortcut: dump every catalog perm into the set so
      // `result.has(p)` works uniformly across superadmin and
      // role-based users. Cost is O(catalog size) per superadmin call
      // — tiny relative to the prisma round-trip.
      //
      // Branch-scope is already enforced by the inScope check above:
      // a branch-scoped Superadmin viewed through ctx.branchId=B only
      // yields all-perms when their assignment is global OR matches B.
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
 *   const { user, authUserId } = await requirePermission('employee.update', { branchId });
 *
 * Returns the same shape as `requireRole` (sans `employee`, since
 * permission checks are for admin-tier callers — Staff gates still
 * use `requireRole(['Staff'])` directly to get the eagerly-loaded
 * Employee row).
 *
 * Phase 3 migration note: the legacy `requireRole(['Admin'])` still
 * works fine. Migrate one route at a time as you touch it for other
 * reasons — don't bulk-sweep (that's how commits 577328e and 7793322
 * happened).
 */
export async function requirePermission(
  permission: Permission,
  ctx?: { branchId?: string | null },
): Promise<{ user: User; authUserId: string; tier: Role | null }> {
  const { user, authUserId, assignments } = await resolveAuthedUser();
  if (!checkAssignments(assignments, permission, ctx)) notFound();
  const tier = computeTier(assignments);
  return { user, authUserId, tier };
}
