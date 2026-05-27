import Link from 'next/link';
import { signIn } from './actions';

type SearchParams = Promise<{ redirectTo?: string; error?: string }>;

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const { redirectTo, error } = await searchParams;

  return (
    <form action={signIn} className="space-y-4">
      <input type="hidden" name="redirectTo" value={redirectTo ?? ''} />

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-gray-700">
          อีเมล
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          className="mt-1.5 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-gray-700">
          รหัสผ่าน
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="mt-1.5 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
        />
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {decodeURIComponent(error)}
        </p>
      )}

      <button
        type="submit"
        className="w-full rounded-md bg-primary-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
      >
        เข้าสู่ระบบ
      </button>

      <div className="border-t border-gray-100 pt-4 text-center text-sm">
        <Link href="/reset-password" className="text-primary-600 hover:text-primary-700">
          ลืมรหัสผ่าน?
        </Link>
      </div>

      <div className="text-center text-xs text-gray-400">พนักงาน: เข้าสู่ระบบผ่านแอป LINE</div>
    </form>
  );
}
