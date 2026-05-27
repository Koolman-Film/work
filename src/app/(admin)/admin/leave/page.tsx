/**
 * /admin/leave — pending leave-request inbox.
 *
 * Default view: only Pending requests, newest-submitted first. Status
 * filter chips (?status=Approved|Rejected|All) let admins look at
 * history.
 *
 * Each row expands inline into a review panel showing the requested
 * range + working-day breakdown (Sundays + Holidays excluded) + a
 * required note + Approve / Reject buttons. Same UX as the disputed-
 * attendance inbox — consistent muscle memory for admins.
 */

import Link from 'next/link';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { prisma } from '@/lib/db/prisma';
import { workingDaysIn } from '@/lib/leave/working-days';
import { LeaveReviewPanel } from './leave-review-panel';

type SearchParams = Promise<{ status?: string }>;

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  Pending: { label: 'รออนุมัติ', cls: 'bg-amber-100 text-amber-800' },
  Approved: { label: 'อนุมัติแล้ว', cls: 'bg-green-100 text-green-800' },
  Rejected: { label: 'ไม่อนุมัติ', cls: 'bg-red-100 text-red-800' },
  Cancelled: { label: 'ยกเลิก', cls: 'bg-gray-100 text-gray-700' },
};

const FILTER_OPTIONS = [
  { value: '', label: 'รออนุมัติ' }, // default
  { value: 'all', label: 'ทั้งหมด' },
  { value: 'approved', label: 'อนุมัติแล้ว' },
  { value: 'rejected', label: 'ไม่อนุมัติ' },
] as const;

function formatRange(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  };
  const same =
    start.getUTCFullYear() === end.getUTCFullYear() &&
    start.getUTCMonth() === end.getUTCMonth() &&
    start.getUTCDate() === end.getUTCDate();
  if (same) return start.toLocaleDateString('th-TH', opts);
  return `${start.toLocaleDateString('th-TH', { ...opts, year: undefined })} – ${end.toLocaleDateString(
    'th-TH',
    opts,
  )}`;
}

function formatDateTime(d: Date): string {
  return d.toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default async function AdminLeaveInboxPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { status } = await searchParams;

  // Map URL filter to Prisma where clause.
  const where = (() => {
    if (status === 'all') return {};
    if (status === 'approved') return { status: 'Approved' as const };
    if (status === 'rejected') return { status: 'Rejected' as const };
    return { status: 'Pending' as const };
  })();

  // We compute the working-day count up-front for each row so the row
  // header can show "= 5 วันทำงาน" without a second pass. This requires
  // pulling holidays in the relevant date range; for simplicity we pull
  // all non-archived holidays (≤ ~30 rows per year, trivial).
  const [rows, holidays] = await Promise.all([
    prisma.leaveRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        startDate: true,
        endDate: true,
        reason: true,
        status: true,
        reviewNote: true,
        reviewedAt: true,
        createdAt: true,
        leaveType: { select: { name: true, isPaid: true } },
        employee: {
          select: {
            firstName: true,
            lastName: true,
            nickname: true,
            branch: { select: { name: true } },
            department: { select: { name: true } },
          },
        },
      },
    }),
    prisma.holiday.findMany({
      where: { archivedAt: null },
      select: { date: true, name: true },
    }),
  ]);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">คำขอลา</h1>
        <p className="mt-1 text-sm text-gray-500">ตรวจสอบและอนุมัติคำขอลาของพนักงาน</p>
      </div>

      {/* Filter chips */}
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTER_OPTIONS.map((opt) => {
          const active = (opt.value === '' && !status) || opt.value === status;
          return (
            <Link
              key={opt.value || 'pending'}
              href={opt.value ? `/admin/leave?status=${opt.value}` : '/admin/leave'}
              className={
                active
                  ? 'rounded-full bg-primary-600 px-3 py-1 text-xs font-medium text-white'
                  : 'rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50'
              }
            >
              {opt.label}
            </Link>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            ทั้งหมด <span className="tabular-nums text-gray-500">({rows.length})</span>
          </CardTitle>
        </CardHeader>
        <CardBody className="!p-0">
          {rows.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm text-gray-500">
                {!status || status === 'pending' ? 'ไม่มีคำขอลาที่รออนุมัติ ✨' : 'ไม่มีรายการในตัวกรองนี้'}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {rows.map((r) => {
                const badge = STATUS_LABEL[r.status] ?? STATUS_LABEL.Pending;
                const wd = workingDaysIn({
                  startDate: r.startDate,
                  endDate: r.endDate,
                  holidays: holidays.map((h) => h.date),
                });
                return (
                  <li key={r.id} className="px-5 py-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          {badge && (
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${badge.cls}`}
                            >
                              {badge.label}
                            </span>
                          )}
                          <p className="truncate text-sm font-medium text-gray-900">
                            {r.employee.firstName} {r.employee.lastName}
                            {r.employee.nickname && (
                              <span className="text-gray-500"> ({r.employee.nickname})</span>
                            )}
                          </p>
                        </div>
                        <p className="mt-1 text-xs text-gray-500">
                          {r.employee.branch.name}
                          {r.employee.department ? ` • ${r.employee.department.name}` : ''}
                        </p>
                      </div>
                      <div className="text-left text-xs text-gray-700 sm:max-w-[300px] sm:text-right">
                        <p>
                          <strong>{r.leaveType.name}</strong>{' '}
                          {r.leaveType.isPaid ? '' : <span className="text-gray-500">(ไม่จ่าย)</span>}
                        </p>
                        <p className="mt-0.5 text-gray-600">
                          {formatRange(r.startDate, r.endDate)} • {wd.length} วันทำงาน
                        </p>
                        <p className="mt-0.5 text-[10px] text-gray-400">
                          ส่งเมื่อ {formatDateTime(r.createdAt)}
                        </p>
                      </div>
                    </div>

                    <p className="mt-3 line-clamp-3 whitespace-pre-wrap text-sm text-gray-700">
                      {r.reason}
                    </p>

                    {r.status === 'Pending' ? (
                      <LeaveReviewPanel
                        leaveRequestId={r.id}
                        workingDays={wd.map((d) => d.toISOString().slice(0, 10))}
                        holidayNames={holidays
                          .filter(
                            (h) =>
                              h.date.getTime() >= r.startDate.getTime() &&
                              h.date.getTime() <= r.endDate.getTime(),
                          )
                          .map((h) => ({
                            date: h.date.toISOString().slice(0, 10),
                            name: h.name,
                          }))}
                      />
                    ) : r.reviewNote ? (
                      <div className="mt-3 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-700">
                        <strong className="text-gray-900">หมายเหตุ:</strong> {r.reviewNote}
                        {r.reviewedAt && (
                          <span className="ml-2 text-gray-400">
                            ({formatDateTime(r.reviewedAt)})
                          </span>
                        )}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
