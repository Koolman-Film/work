import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { createClient } from '@/lib/supabase/server';

/**
 * Public home + role-aware router for logged-in users.
 *
 * Unauthenticated → show scaffold-status page with login link.
 * Authenticated   → redirect to role's home (/admin, /owner, /liff/check-in).
 *
 * Why route from here rather than middleware?
 *   - Middleware only knows "is there a session"; it can't query our User
 *     table for `role`. Doing the role lookup in middleware would require
 *     a DB call on every request, including statics. Cheaper to route once
 *     at "/" and let `requireRole()` in the destination guard the rest.
 */

const ROLE_HOMES: Record<string, string> = {
  Admin: '/admin',
  Owner: '/owner',
  Employee: '/liff/check-in', // Phase 1 W3 destination — not built yet, but where we'll send them
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
    // If User row missing or archived, fall through to public view.
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold text-primary-700">Koolman HR</h1>
      <p className="mt-2 text-gray-600">ระบบ HR ภายในของ Koolman</p>

      <section className="mt-10 rounded-lg border border-gray-200 bg-gray-50 p-6">
        <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">
          Scaffold status
        </h2>
        <ul className="mt-3 space-y-1.5 text-sm text-gray-700">
          <li>✅ W1a — Next.js 16 + React 19 + Tailwind 4 + Biome + TS</li>
          <li>✅ W1b — Supabase SSR + middleware + login / reset / update-password</li>
          <li>✅ W1c — Prisma schema (15 tables) + seed + requireRole + audit log</li>
          <li>⏳ W2 — Admin CRUD (employees, branches, departments, accounting groups)</li>
        </ul>
      </section>

      <nav className="mt-8 flex flex-wrap gap-3 text-sm">
        <Link
          href="/login"
          className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700"
        >
          เข้าสู่ระบบ
        </Link>
      </nav>
    </main>
  );
}
