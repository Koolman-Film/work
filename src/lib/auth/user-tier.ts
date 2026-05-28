/**
 * Compute a user's "tier" (Staff / Admin / Superadmin) from their
 * active role assignments.
 *
 * Pre-Phase 4 this was a column read: `user.role`. The column has
 * been retired (or is on its way out — Phase 4.6 actually drops it);
 * tier is now a derived view of UserRoleAssignment.
 *
 * Tier semantics — highest-wins:
 *   Any active assignment to a role with isSuperadmin=true → 'Superadmin'
 *   Else any active assignment to the 'admin' system role     → 'Admin'
 *   Else any active assignment to the 'staff' system role     → 'Staff'
 *   Else                                                       → null
 *
 * Why tier instead of just "role-of-highest-permission":
 *   The codebase has handful of places where coarse-grained "are you
 *   admin-class" matters distinct from per-permission checks (route
 *   group gates, /-redirect routing, audit display, UI badges). Tier
 *   captures that without dragging the whole permission catalog into
 *   the check.
 *
 * Custom (non-system) roles don't affect tier even if they grant
 * elevated permissions. Tier is specifically the "system tier
 * classification" for UI/routing — fine-grained authorization always
 * goes through canDo()/requirePermission().
 *
 * Separation of pure decision (`computeTier`) from I/O wrapper
 * (`getUserTier`) follows the same pattern as canDo +
 * checkAssignments and is what makes unit-testing trivial.
 */

import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

/** The narrow shape `computeTier` needs from each assignment. */
export type TierAssignment = {
  role: {
    key: string;
    isSuperadmin: boolean;
    archivedAt: Date | null;
  };
};

/**
 * Pure policy: given a user's assignments, what tier are they?
 *
 * Exposed for unit-testing. The wrapper `getUserTier` does the DB
 * lookup and delegates here.
 *
 * Returns `null` for a user with zero active assignments — caller
 * decides what to do (typically: not-found / redirect to /login).
 */
export function computeTier(assignments: ReadonlyArray<TierAssignment>): Role | null {
  let hasAdmin = false;
  let hasStaff = false;
  for (const a of assignments) {
    if (a.role.archivedAt) continue;
    if (a.role.isSuperadmin) return 'Superadmin';
    if (a.role.key === 'admin') hasAdmin = true;
    else if (a.role.key === 'staff') hasStaff = true;
  }
  if (hasAdmin) return 'Admin';
  if (hasStaff) return 'Staff';
  return null;
}

/**
 * I/O wrapper. One DB round-trip; lighter than `getUserAssignments`
 * (in check-permission.ts) because we only need the role's key +
 * flags, not the full permission list.
 *
 * Caller-side note: `requireRole` extends its existing prisma query
 * to include role assignments — when you already have a `user` object
 * loaded from `requireRole`, use the assignments on it via the helper
 * `tierFromUser(user)` if available, NOT this function. This function
 * is for cases where you only have the user.id.
 */
export async function getUserTier(userId: string): Promise<Role | null> {
  const assignments = await prisma.userRoleAssignment.findMany({
    where: { userId },
    select: {
      role: {
        select: {
          key: true,
          isSuperadmin: true,
          archivedAt: true,
        },
      },
    },
  });
  return computeTier(assignments);
}
