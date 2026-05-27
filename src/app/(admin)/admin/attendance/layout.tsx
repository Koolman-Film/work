/**
 * Attendance layout — same two-column shape as Settings.
 *
 * Outer admin layout provides topbar + sidebar; this adds the inner
 * tab nav (Disputed / Live / Manual).
 */

import { AttendanceNav } from './attendance-nav';

export default function AttendanceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">ลงเวลา</h1>
        <p className="mt-1 text-sm text-gray-500">ตรวจสอบและจัดการบันทึกการเช็คอินของพนักงาน</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_1fr]">
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <AttendanceNav />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
