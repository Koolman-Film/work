import Link from 'next/link';

export default function HomePage() {
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
          <li>⏳ W1c — Prisma schema + seed + requireRole + audit log</li>
        </ul>
      </section>

      <nav className="mt-8 flex flex-wrap gap-3 text-sm">
        <Link
          href="/login"
          className="inline-flex items-center rounded-md bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700"
        >
          เข้าสู่ระบบ
        </Link>
        <Link
          href="/admin"
          className="inline-flex items-center rounded-md border border-gray-300 px-4 py-2 font-medium text-gray-700 hover:bg-gray-50"
        >
          /admin (protected)
        </Link>
        <Link
          href="/owner"
          className="inline-flex items-center rounded-md border border-gray-300 px-4 py-2 font-medium text-gray-700 hover:bg-gray-50"
        >
          /owner (protected)
        </Link>
      </nav>
    </main>
  );
}
