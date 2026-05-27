/**
 * Admin home — placeholder until W1c lands the real dashboard.
 *
 * Today: just confirms the user is authenticated. The middleware already
 * guarantees that — anyone unauthenticated who hits /admin was bounced
 * to /login by middleware.ts before this Server Component ran.
 *
 * In W1c this gets `requireRole(['Admin'])` so non-admins get a 404.
 */

import { createClient } from '@/lib/supabase/server';

export default async function AdminHomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold text-primary-700">Admin (W1b placeholder)</h1>
      <p className="mt-2 text-gray-600">
        Welcome. Once W1c lands the User table, this page will check `role === Admin`.
      </p>

      <section className="mt-8 rounded-lg border border-gray-200 bg-gray-50 p-6">
        <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">
          Session info (auth.users only — no role lookup yet)
        </h2>
        <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="font-medium text-gray-700">id</dt>
          <dd className="font-mono text-gray-900">{user?.id ?? '—'}</dd>
          <dt className="font-medium text-gray-700">email</dt>
          <dd className="text-gray-900">{user?.email ?? '—'}</dd>
          <dt className="font-medium text-gray-700">provider</dt>
          <dd className="text-gray-900">{user?.app_metadata?.provider ?? '—'}</dd>
        </dl>
      </section>

      <form action="/logout" method="post" className="mt-6">
        <button
          type="submit"
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          ออกจากระบบ
        </button>
      </form>
    </main>
  );
}
