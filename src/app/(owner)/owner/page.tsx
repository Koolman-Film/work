/**
 * Owner home — placeholder until W3 lands the real read-only dashboard.
 *
 * Same shape as /admin for now; distinguished by route group so middleware
 * + future role-check apply to /owner specifically.
 */

import { createClient } from '@/lib/supabase/server';

export default async function OwnerHomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold text-primary-700">Owner (W1b placeholder)</h1>
      <p className="mt-2 text-gray-600">Read-only dashboard arrives in Phase 3.</p>

      <section className="mt-8 rounded-lg border border-gray-200 bg-gray-50 p-6">
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="font-medium text-gray-700">id</dt>
          <dd className="font-mono text-gray-900">{user?.id ?? '—'}</dd>
          <dt className="font-medium text-gray-700">email</dt>
          <dd className="text-gray-900">{user?.email ?? '—'}</dd>
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
