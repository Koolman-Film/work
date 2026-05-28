/**
 * `requireRole()` — the single role gate for every protected Server Action,
 * Server Component, and Route Handler.
 *
 * Flow:
 *   1. Read the Supabase session (cookie-based via @supabase/ssr).
 *   2. Look up our `User` row by the session's auth.users.id.
 *   3. Reject if no user, archived, or role not in the allowlist.
 *   4. Eagerly join the Employee row when role==Employee (most callers need it).
 *
 * Why this lives in a single helper:
 *   - Centralizes the authn → authz chain so we can audit/refactor in one place.
 *   - Forces every protected entry point to think "what roles am I gating on?"
 *     by requiring the `roles` argument — no implicit "any logged-in user".
 *
 * Behavior on failure:
 *   - `notFound()` (HTTP 404) on missing session — never reveal "you exist but
 *     aren't allowed", since that leaks which routes exist.
 *   - `notFound()` on role mismatch too — same reasoning.
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
 */

import type { Employee, Role, User } from '@prisma/client';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { createClient } from '@/lib/supabase/server';

export type RequireRoleResult = {
  user: User;
  /** Eagerly loaded when user.role === 'Staff'; undefined otherwise. */
  employee?: Employee;
  /** Supabase auth.users.id — UUID. Same as user.authUserId, exposed for convenience. */
  authUserId: string;
};

export async function requireRole(roles: readonly Role[]): Promise<RequireRoleResult> {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) notFound();

  // Single round-trip: fetch User + (optionally) Employee in one query.
  const user = await prisma.user.findUnique({
    where: { authUserId: authUser.id },
    include: { employee: true },
  });

  if (!user) {
    // Authenticated to Supabase but no matching User row — shouldn't happen
    // outside of mid-seed states. Treat as unauthorized.
    notFound();
  }

  if (user.archivedAt !== null) notFound();

  // Role check with Superadmin auto-elevation:
  //   - If the caller's allowlist includes the user's role exactly, accept.
  //   - If the user is Superadmin AND the allowlist asks for Admin, ALSO
  //     accept. Superadmin is by definition a superset of Admin, so
  //     gating an /admin/* page on ['Admin'] should never block a
  //     Superadmin. Without this, 37+ callsites would have to be
  //     manually updated to ['Admin', 'Superadmin'] — high-risk sweep
  //     that's easy to miss.
  //   - We do NOT auto-elevate Superadmin into 'Staff' gates, because
  //     'Staff' gates intentionally check for an Employee row (LIFF
  //     check-in eligibility, etc.) — a Superadmin without an Employee
  //     row would hit that downstream check anyway.
  const allowed =
    roles.includes(user.role) || (user.role === 'Superadmin' && roles.includes('Admin'));
  if (!allowed) notFound();

  const { employee, ...userOnly } = user;
  return {
    user: userOnly,
    employee: employee ?? undefined,
    authUserId: authUser.id,
  };
}

/**
 * Variant used by LIFF endpoints that need to enforce check-in eligibility
 * on top of just "authenticated employee". Combines requireRole(['Staff'])
 * with status/canCheckIn checks.
 */
export async function requireCheckInPermission(): Promise<
  RequireRoleResult & { employee: Employee }
> {
  const result = await requireRole(['Staff']);
  if (!result.employee) notFound();
  if (result.employee.status === 'Archived') notFound();
  if (!result.employee.canCheckIn) notFound();
  return { ...result, employee: result.employee };
}
