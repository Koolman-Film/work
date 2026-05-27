/**
 * Placeholder for the W3b check-in / check-out page.
 *
 * Right now this just confirms the LIFF→Supabase session is alive and
 * the User row resolves with role='Employee'. W3b replaces this with the
 * GPS + geofence + selfie capture flow.
 *
 * Why ship a placeholder now (W3a) instead of dropping the redirect at
 * the end of /liff/pair into a 404:
 *   - A freshly-paired employee seeing "Page not found" right after the
 *     "Linked successfully" toast is alarming. A clear "you're in, the
 *     check-in screen is coming next" message is honest and reassuring.
 *   - It also lets us smoke-test the requireRole(['Employee']) path
 *     against a real LINE-paired Supabase session before the full feature
 *     lands.
 */

import { requireRole } from '@/lib/auth/require-role';

export default async function LiffCheckInPlaceholder() {
  const { employee } = await requireRole(['Employee']);

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-12">
      <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <p className="text-sm text-gray-500">Koolman HR</p>
        <h1 className="mt-1 text-xl font-semibold text-gray-900">เชื่อมบัญชีสำเร็จ</h1>
        <p className="mt-3 text-sm text-gray-600">
          ยินดีต้อนรับ
          {employee ? <strong className="text-gray-900"> {employee.firstName}</strong> : ''}
        </p>
        <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-left text-xs text-amber-800">
          <strong>กำลังก่อสร้าง:</strong> หน้าเช็คอิน / เช็คเอาท์ จะมาถึงในสัปดาห์หน้า (W3b).
          ตอนนี้บัญชีของคุณพร้อมใช้งานแล้ว — รอเปิดให้บริการ.
        </div>
      </div>
    </div>
  );
}
