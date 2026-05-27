/**
 * Admin home — placeholder until W2 lands the real dashboard.
 *
 * Authorization is now role-aware: `requireRole(['Admin'])` resolves the
 * Supabase session → our User row → confirms role === Admin. Anyone else
 * gets 404 (including authenticated Owners hitting this page — they belong
 * at /owner).
 */

import { requireRole } from '@/lib/auth/require-role';

export default async function AdminHomePage() {
  const { user, authUserId } = await requireRole(['Admin']);

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold text-primary-700">Admin (W1c placeholder)</h1>
      <p className="mt-2 text-gray-600">Hello, {user.email}. The real dashboard arrives in W2.</p>

      <section className="mt-8 rounded-lg border border-gray-200 bg-gray-50 p-6">
        <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">
          Resolved session
        </h2>
        <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="font-medium text-gray-700">role</dt>
          <dd className="text-gray-900">{user.role}</dd>
          <dt className="font-medium text-gray-700">User.id</dt>
          <dd className="font-mono text-xs text-gray-900">{user.id}</dd>
          <dt className="font-medium text-gray-700">auth.users.id</dt>
          <dd className="font-mono text-xs text-gray-900">{authUserId}</dd>
          <dt className="font-medium text-gray-700">email</dt>
          <dd className="text-gray-900">{user.email ?? '—'}</dd>
          <dt className="font-medium text-gray-700">created</dt>
          <dd className="text-gray-900">{user.createdAt.toISOString()}</dd>
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
