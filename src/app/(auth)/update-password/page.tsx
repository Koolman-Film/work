import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { updatePassword } from './actions';

type SearchParams = Promise<{ error?: string }>;

export default async function UpdatePasswordPage({ searchParams }: { searchParams: SearchParams }) {
  const { error } = await searchParams;

  // Only reachable mid-flow: the auth/callback route exchanged the reset
  // link's token for a session before redirecting here. If there's no
  // session, the link expired or wasn't followed correctly.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/reset-password?error=${encodeURIComponent('ลิงก์หมดอายุหรือไม่ถูกต้อง — ขอลิงก์ใหม่')}`);
  }

  return (
    <form action={updatePassword} className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">ตั้งรหัสผ่านใหม่</h2>
        <p className="mt-1 text-sm text-gray-500">รหัสผ่านอย่างน้อย 8 ตัวอักษร</p>
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-gray-700">
          รหัสผ่านใหม่
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="mt-1.5 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
        />
      </div>

      <div>
        <label htmlFor="confirm" className="block text-sm font-medium text-gray-700">
          ยืนยันรหัสผ่าน
        </label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
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
        บันทึกรหัสผ่านใหม่
      </button>
    </form>
  );
}
