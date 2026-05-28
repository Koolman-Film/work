/**
 * /liff/leave — list of own leave requests.
 *
 * Phase-1 simplicity: single list, newest first, status badges. The
 * "filter chips" (All / Pending / Approved / etc) the v1 spec described
 * land in W4-polish if we find we need them — for now the list is short
 * enough that an employee can scan it.
 */

import Link from 'next/link';
import { requireRole } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  Pending: { label: 'รออนุมัติ', cls: 'bg-amber-100 text-amber-800' },
  Approved: { label: 'อนุมัติแล้ว', cls: 'bg-green-100 text-green-800' },
  Rejected: { label: 'ไม่อนุมัติ', cls: 'bg-red-100 text-red-800' },
  Cancelled: { label: 'ยกเลิก', cls: 'bg-gray-100 text-gray-700' },
};

function formatRange(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: 'UTC', // we stored as UTC midnight; show that calendar day
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  };
  if (
    start.getUTCFullYear() === end.getUTCFullYear() &&
    start.getUTCMonth() === end.getUTCMonth() &&
    start.getUTCDate() === end.getUTCDate()
  ) {
    return start.toLocaleDateString('th-TH', opts);
  }
  return `${start.toLocaleDateString('th-TH', { ...opts, year: undefined })} – ${end.toLocaleDateString(
    'th-TH',
    opts,
  )}`;
}

export default async function LiffLeaveListPage() {
  const { employee } = await requireRole(['Staff']);
  if (!employee) throw new Error('requireRole did not return Employee');

  const rows = await prisma.leaveRequest.findMany({
    where: { employeeId: employee.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      leaveType: { select: { name: true } },
      startDate: true,
      endDate: true,
      reason: true,
      status: true,
      createdAt: true,
    },
  });

  return (
    <main className="mx-auto max-w-md px-4 pt-8 pb-12">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">คำขอลาของฉัน</h1>
          <p className="mt-0.5 text-sm text-gray-500">{rows.length} รายการ</p>
        </div>
        <Link
          href="/liff/leave/new"
          className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700"
        >
          + ส่งคำขอ
        </Link>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-12 text-center">
          <p className="text-sm text-gray-500">ยังไม่มีคำขอลา</p>
          <Link
            href="/liff/leave/new"
            className="mt-3 inline-block text-sm font-medium text-primary-700 hover:text-primary-800"
          >
            ส่งคำขอแรก →
          </Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const badge = STATUS_LABEL[r.status] ?? STATUS_LABEL.Pending;
            return (
              <li key={r.id}>
                <Link
                  href={`/liff/leave/${r.id}`}
                  className="block rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-primary-200 hover:bg-primary-50/30"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">{r.leaveType.name}</p>
                      <p className="mt-1 text-xs text-gray-600">
                        {formatRange(r.startDate, r.endDate)}
                      </p>
                      <p className="mt-1 line-clamp-2 text-xs text-gray-500">{r.reason}</p>
                    </div>
                    {badge && (
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.cls}`}
                      >
                        {badge.label}
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <nav className="mt-8 flex justify-center gap-4 text-xs">
        <Link href="/liff/check-in" className="text-gray-500 hover:text-gray-700">
          ← กลับหน้าเช็คอิน
        </Link>
        <Link href="/liff/calendar" className="text-gray-500 hover:text-gray-700">
          ดูปฏิทินทีม →
        </Link>
      </nav>
    </main>
  );
}
