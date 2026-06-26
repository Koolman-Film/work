/**
 * `requireRole()` — the single role gate for every protected Server Action,
 * Server Component, and Route Handler.
 *
 * Flow:
 *   1. Read the Supabase session (cookie-based via @supabase/ssr).
 *   2. Look up our `User` row by the session's auth.users.id, eagerly
 *      including `employee` and `roleAssignments` (with role definitions).
 *   3. Compute the user's TIER from their assignments (Phase 4 — used
 *      to be `user.role` enum column read).
 *   4. Reject if no user, archived, or tier not in the allowlist.
 *
 * Why one helper:
 *   - Centralizes the authn → authz chain so we can audit/refactor in one place.
 *   - Forces every protected entry point to think "what roles am I gating on?"
 *     by requiring the `roles` argument — no implicit "any logged-in user".
 *
 * Behavior on failure:
 *   - `notFound()` (HTTP 404) on missing session — never reveal "you exist but
 *     aren't allowed", since that leaks which routes exist.
 *   - `notFound()` on tier mismatch too — same reasoning.
 *   - Server Actions called from a logged-out client will see this as a thrown
 *     `NEXT_NOT_FOUND` error; Server Components hit the same path and Next.js
 *     renders the nearest `not-found.tsx`.
 *
 * Why not throw a custom error?
 *   - We tried that. Server Actions can't propagate custom error types cleanly
 *     across the RPC boundary — Next strips them to "An error occurred."
 *   - `notFound()` and `forbidden()` are the two sanctioned Next.js control-flow
 *     mechanisms that survive the boundary; we use `notFound()` uniformly to
 *     avoid signaling existence to unauthorized callers.
 *
 * Phase 4 note: this previously read `user.role` (a legacy enum column).
 * The check now derives the tier from active `UserRoleAssignment` rows
 * via `computeTier`. The prisma `include` was extended to fetch
 * `roleAssignments` in the same round-trip — no additional latency.
 * Phase 4.6 drops the `User.role` column entirely.
 *
 * LIFF admin fallback: an admin paired via /liff/pair-admin keeps their
 * email auth.users id on `User.authUserId`, while their LIFF session is a
 * separate LINE-minted auth user. When the primary authUserId lookup
 * misses, we resolve the session's verified `custom:line` identity sub
 * against `User.lineUserId`. Workers never need this — their pairing
 * binds authUserId to the LINE auth user directly. The returned
 * `authUserId` is always the SESSION auth id (storage-path security
 * checks compare against it), not the User row's column.
 */

import type { Employee, Role, User } from '@prisma/client';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { createClient } from '@/lib/supabase/server';
import { computeTier } from './user-tier';

export type RequireRoleResult = {
  user: User;
  /** Eagerly loaded when the user is Staff tier; undefined otherwise. */
  employee?: Employee;
  /** Computed from active role assignments — see computeTier(). */
  tier: Role;
  /** Supabase auth.users.id — UUID. Same as user.authUserId, exposed for convenience. */
  authUserId: string;
};

export async function requireRole(roles: readonly Role[]): Promise<RequireRoleResult> {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) notFound();

  // Single round-trip: fetch User + (optionally) Employee + role
  // assignments in one query. We need assignments to compute tier;
  // folding them into the existing include keeps auth at one network
  // hop. The select on `role` is narrow — we only need the fields
  // computeTier looks at.
  const includeShape = {
    employee: true,
    roleAssignments: {
      select: {
        role: { select: { key: true, isSuperadmin: true, archivedAt: true } },
      },
    },
  } as const;

  let user = await prisma.user.findUnique({
    where: { authUserId: authUser.id },
    include: includeShape,
  });

  // LIFF fallback: an admin paired via /liff/pair-admin keeps their
  // email auth.users id on User.authUserId, while the LIFF session is a
  // separate LINE-minted auth user. Resolve by the session's verified
  // custom:line identity → User.lineUserId. Workers never reach here
  // (their pairing binds authUserId to the LINE auth user directly).
  if (!user) {
    const lineSub = (authUser.identities ?? []).find((i) => i.provider === 'custom:line')?.id;
    if (lineSub) {
      user = await prisma.user.findUnique({
        where: { lineUserId: lineSub },
        include: includeShape,
      });
    }
  }

  if (!user) {
    // Authenticated to Supabase but no matching User row — shouldn't happen
    // outside of mid-seed states. Treat as unauthorized.
    notFound();
  }

  if (user.archivedAt !== null) notFound();

  // Compute the user's tier from their active assignments. A user
  // with no assignments returns null — we treat them as unauthorized
  // (defensive: shouldn't happen post-Phase-4.1, but if a developer
  // creates a User row by hand without an assignment, they get an
  // opaque 404 here rather than silently passing through with a
  // stale legacy enum).
  const tier = computeTier(user.roleAssignments);
  if (tier === null) notFound();

  // Tier check with Superadmin auto-elevation:
  //   - If the caller's allowlist includes the user's tier exactly, accept.
  //   - If the user is Superadmin AND the allowlist asks for Admin, ALSO
  //     accept. Superadmin is by definition a superset of Admin, so
  //     gating an /admin/* page on ['Admin'] should never block a
  //     Superadmin.
  //   - We do NOT auto-elevate Superadmin into 'Staff' gates, because
  //     'Staff' gates intentionally check for an Employee row (LIFF
  //     check-in eligibility, etc.) — a Superadmin without an Employee
  //     row would hit that downstream check anyway.
  const allowed = roles.includes(tier) || (tier === 'Superadmin' && roles.includes('Admin'));
  if (!allowed) notFound();

  // Strip the included relations so callers see a plain `User` shape.
  // (`roleAssignments` and `employee` are exposed separately on the
  // RequireRoleResult.)
  const { employee, roleAssignments: _ra, ...userOnly } = user;
  return {
    user: userOnly as User,
    employee: employee ?? undefined,
    tier,
    authUserId: authUser.id,
  };
}

/**
 * Any authenticated user that HAS an Employee record — regardless of tier.
 * This is the source-of-truth gate for employee-facing features: an
 * admin-employee computes to tier 'Admin' (computeTier is highest-wins) yet
 * is still a worker, so we must NOT gate on tier === 'Staff'. Pure admins
 * (no Employee) are rejected here exactly as the old Staff gate rejected them.
 */
export async function requireEmployee(): Promise<RequireRoleResult & { employee: Employee }> {
  const result = await requireRole(['Staff', 'Admin', 'Superadmin']);
  if (!result.employee) notFound();
  return { ...result, employee: result.employee };
}

/**
 * Check-in eligibility: an employee who is Active and allowed to check in.
 * Builds on requireEmployee so admin-employees can check in too.
 */
export async function requireCheckInPermission(): Promise<
  RequireRoleResult & { employee: Employee }
> {
  const result = await requireEmployee();
  if (result.employee.status === 'Archived') notFound();
  if (!result.employee.canCheckIn) notFound();
  return result;
}
