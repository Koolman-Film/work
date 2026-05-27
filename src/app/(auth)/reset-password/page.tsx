import Link from 'next/link';
import { requestPasswordReset } from './actions';

type SearchParams = Promise<{ sent?: string; error?: string }>;

export default async function ResetPasswordPage({ searchParams }: { searchParams: SearchParams }) {
  const { sent, error } = await searchParams;

  if (sent === '1') {
    return (
      <div className="space-y-4 text-center">
        <h2 className="text-lg font-semibold text-gray-900">ส่งลิงก์รีเซ็ตแล้ว</h2>
        <p className="text-sm text-gray-600">
          ถ้าอีเมลที่กรอกมีในระบบ คุณจะได้รับลิงก์ตั้งรหัสผ่านใหม่ภายในไม่กี่นาที.
        </p>
        <Link
          href="/login"
          className="inline-block text-sm text-primary-600 hover:text-primary-700"
        >
          ← กลับไปหน้าล็อกอิน
        </Link>
      </div>
    );
  }

  return (
    <form action={requestPasswordReset} className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">ลืมรหัสผ่าน</h2>
        <p className="mt-1 text-sm text-gray-500">กรอกอีเมลที่ใช้ลงทะเบียน เราจะส่งลิงก์ตั้งรหัสผ่านใหม่ให้</p>
      </div>

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

      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {decodeURIComponent(error)}
        </p>
      )}

      <button
        type="submit"
        className="w-full rounded-md bg-primary-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
      >
        ส่งลิงก์รีเซ็ต
      </button>

      <div className="border-t border-gray-100 pt-4 text-center text-sm">
        <Link href="/login" className="text-primary-600 hover:text-primary-700">
          ← กลับไปหน้าล็อกอิน
        </Link>
      </div>
    </form>
  );
}
