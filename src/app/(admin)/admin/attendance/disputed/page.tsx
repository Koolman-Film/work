/**
 * /admin/attendance/disputed — review inbox for Disputed check-ins.
 *
 * Lists every Attendance row of type=CheckIn with checkInStatus=Disputed
 * (newest first), grouped visually by date. Each row expands into a
 * client-side panel with the GPS reading, the would-have-matched branch,
 * the system's dispute reason in Thai, and Approve/Reject buttons that
 * call the review server actions.
 *
 * Why inline expansion instead of a drawer or modal:
 *   - Dataset is small (≤20 employees × occasional disputes); a list of
 *     5–10 items with inline-expand panels is faster to scan than a list
 *     where every detail requires a click-out-click-in.
 *   - Avoids the "where did the row I just approved go?" disorientation
 *     that drawers create when their parent list re-fetches.
 *
 * Read-only fetch is a Server Component, action UI is a child Client
 * Component.
 */

import Link from 'next/link';
import { prisma } from '@/lib/db/prisma';
import { DisputedReviewPanel } from './disputed-review-panel';

const STATUS_FILTER = ['Disputed'] as const;

function formatBkk(d: Date): string {
  return d.toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    day: 'numeric',
    month: 'short',
  });
}

export default async function DisputedInboxPage() {
  // Fetch up to 50 disputed rows, newest first. UI shows "more" prompt if
  // we hit the cap.
  const rows = await prisma.attendance.findMany({
    where: {
      type: 'CheckIn',
      checkInStatus: { in: [...STATUS_FILTER] },
    },
    orderBy: { clockInAt: 'desc' },
    take: 50,
    select: {
      id: true,
      date: true,
      clockInAt: true,
      checkInLat: true,
      checkInLng: true,
      checkInStatus: true,
      disputeReason: true,
      checkInBranch: {
        select: { id: true, name: true, latitude: true, longitude: true, radiusMeters: true },
      },
      employee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          nickname: true,
          branch: { select: { name: true } },
          department: { select: { name: true } },
        },
      },
    },
  });

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-12 text-center">
        <p className="text-sm text-gray-500">ไม่มีรายการที่ต้องตรวจสอบ ✨</p>
        <p className="mt-1 text-xs text-gray-400">
          การเช็คอินทั้งหมดผ่านการตรวจอัตโนมัติ — ไม่มีอะไรต้องตัดสินใจ
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          <strong className="font-semibold text-gray-700">{rows.length}</strong> รายการ
          {rows.length === 50 ? ' (แสดง 50 รายการล่าสุด)' : ''}
        </p>
      </div>

      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} className="rounded-xl border border-amber-200 bg-amber-50/40">
            <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800">
                    Disputed
                  </span>
                  <p className="truncate text-sm font-medium text-gray-900">
                    {r.employee.firstName} {r.employee.lastName}
                    {r.employee.nickname ? (
                      <span className="text-gray-500"> ({r.employee.nickname})</span>
                    ) : null}
                  </p>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  {r.employee.branch.name}
                  {r.employee.department ? ` • ${r.employee.department.name}` : ''}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  เช็คอินเมื่อ {r.clockInAt ? formatBkk(r.clockInAt) : '—'}
                </p>
              </div>
              <div className="text-left text-xs text-amber-900 sm:max-w-[260px] sm:text-right">
                <span className="font-medium">เหตุผล:</span> {r.disputeReason ?? 'ไม่ระบุ'}
              </div>
            </div>

            <DisputedReviewPanel
              attendanceId={r.id}
              employeeName={`${r.employee.firstName} ${r.employee.lastName}`}
              clockInAtIso={r.clockInAt ? r.clockInAt.toISOString() : null}
              latitude={r.checkInLat ? Number(r.checkInLat) : null}
              longitude={r.checkInLng ? Number(r.checkInLng) : null}
              candidateBranch={
                r.checkInBranch?.latitude && r.checkInBranch.longitude
                  ? {
                      id: r.checkInBranch.id,
                      name: r.checkInBranch.name,
                      latitude: Number(r.checkInBranch.latitude),
                      longitude: Number(r.checkInBranch.longitude),
                      radiusMeters: r.checkInBranch.radiusMeters,
                    }
                  : null
              }
            />
          </li>
        ))}
      </ul>

      <p className="pt-2 text-center text-xs text-gray-400">
        แสดงเฉพาะรายการที่ยังไม่ได้ตัดสินใจ — เมื่อตัดสินใจแล้วจะหายไปจากรายการนี้.{' '}
        <Link href="/admin/audit" className="underline">
          ดูประวัติทั้งหมด
        </Link>
      </p>
    </div>
  );
}
