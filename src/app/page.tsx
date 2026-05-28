import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { createClient } from '@/lib/supabase/server';

/**
 * Bare-domain router — sends every visitor to the right destination.
 *
 *   - Unauthenticated   → /login
 *   - Admin             → /admin
 *   - Superadmin        → /admin   (full powers; can still navigate to
 *                                   /owner for the read-only dashboard)
 *   - Staff             → /liff/check-in
 *   - Auth-but-no-User  → /login   (defensive — happens mid-seed only)
 *   - Auth-but-archived → /login   (former employee revoked)
 *
 * Why route from here rather than middleware?
 *   - Middleware only knows "is there a session"; it can't query our User
 *     table for `role`. Doing the role lookup in middleware would require
 *     a DB call on every request, including statics. Cheaper to route once
 *     at "/" and let `requireRole()` in the destination guard the rest.
 *
 * History: the Owner→Superadmin and Employee→Staff enum rename in
 * migration 0009 broke this map because the keys were UNQUOTED object
 * literal keys — the bulk sed (which targeted only single-quoted enum
 * literals) skipped them. Result: a redirect loop for Superadmin/Staff
 * users — ROLE_HOMES[user.role] returned undefined → fall through to
 * /login → proxy bounces back → loop. Fixed 2026-05-28.
 */

const ROLE_HOMES: Record<string, string> = {
  Admin: '/admin',
  Superadmin: '/admin',
  Staff: '/liff/check-in',
};

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (authUser) {
    const user = await prisma.user.findUnique({
      where: { authUserId: authUser.id },
      select: { role: true, archivedAt: true },
    });
    if (user && !user.archivedAt) {
      const home = ROLE_HOMES[user.role];
      if (home) redirect(home);
    }
    // User row missing or archived → fall through to /login. Returning
    // them to login (rather than 404) gives a recoverable path: they can
    // try a different account or contact admin.
  }

  redirect('/login');
}
