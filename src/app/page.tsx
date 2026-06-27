import { redirect } from 'next/navigation';
import { hasAdminAreaAccess } from '@/lib/auth/admin-area';
import { permissionsFromAssignments } from '@/lib/auth/check-permission';
import { computeTier } from '@/lib/auth/user-tier';
import { prisma } from '@/lib/db/prisma';
import { createClient } from '@/lib/supabase/server';

/**
 * Bare-domain router — sends every visitor to the right destination.
 *
 *   - Unauthenticated          → /login
 *   - Admin-employee (both)    → /liff/home  (unified identity home)
 *   - Employee-only            → /liff/check-in
 *   - Admin/Superadmin-only    → /admin
 *   - Custom-role-only (back-office perms) → /admin
 *   - Auth-but-no-User         → /login  (defensive — happens mid-seed only)
 *   - Auth-but-archived        → /login  (former employee revoked)
 *
 * Routing is on two real booleans derived from the DB:
 *   hasEmployee    — the User has an Employee record
 *   isAdminCapable — has back-office access (system tier OR a custom role with admin permissions)
 *
 * This replaces the old TIER_HOMES map (highest-wins tier → single route),
 * which could never reach /liff/home for an admin-employee because
 * computeTier returns 'Admin' (highest wins) and the map sent that to /admin.
 *
 * Why route from here rather than middleware?
 *   - Middleware only knows "is there a session"; it can't query our User
 *     table for `role`. Doing the role lookup in middleware would require
 *     a DB call on every request, including statics. Cheaper to route once
 *     at "/" and let `requireRole()` in the destination guard the rest.
 */

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (authUser) {
    // Fetch User + active assignments in one query — same pattern as
    // requireRole (lib/auth/require-role.ts). We need the assignments
    // to compute tier; we keep the include narrow (just the
    // tier-relevant role fields).
    const user = await prisma.user.findUnique({
      where: { authUserId: authUser.id },
      select: {
        archivedAt: true,
        employee: { select: { id: true } },
        roleAssignments: {
          select: {
            branchId: true,
            role: {
              select: { key: true, isSuperadmin: true, archivedAt: true, permissions: true },
            },
          },
        },
      },
    });
    if (user && !user.archivedAt) {
      const tier = computeTier(user.roleAssignments);
      const permissions = permissionsFromAssignments(user.roleAssignments);
      const hasEmployee = user.employee !== null;
      const isAdminCapable = hasAdminAreaAccess(permissions, tier);
      if (hasEmployee && isAdminCapable) redirect('/liff/home');
      if (hasEmployee) redirect('/liff/check-in');
      if (isAdminCapable) redirect('/admin');
      // else: no employee and no admin tier → fall through to /login
    }
    // User row missing, archived, or no active assignments → fall
    // through to /login. Returning them to login (rather than 404)
    // gives a recoverable path: they can try a different account
    // or contact admin.
  }

  redirect('/login');
}
