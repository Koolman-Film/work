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
import { RestoreButton, VoidDialog } from '@/components/admin/void-dialog';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge, type StatusKey } from '@/components/ui/status-badge';
import { prisma, prismaRaw } from '@/lib/db/prisma';
import { restoreLeaveRequest, voidLeaveRequest } from '@/lib/leave/void';
import { expandHolidaysWithSubstitutes, workingDaysIn } from '@/lib/leave/working-days';
import { signAttendancePhotoUrls } from '@/lib/storage/signed-urls';
import { LeaveReviewPanel } from './leave-review-panel';

type SearchParams = Promise<{ status?: string; trash?: string }>;

const STATUS_INFO: Record<string, { label: string; key: StatusKey }> = {
  Pending: { label: 'รออนุมัติ', key: 'pending' },
  Approved: { label: 'อนุมัติแล้ว', key: 'approved' },
  Rejected: { label: 'ไม่อนุมัติ', key: 'rejected' },
  Cancelled: { label: 'ยกเลิก', key: 'cancelled' },
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
  const { status, trash } = await searchParams;
  const isTrash = trash === '1';

  // Map URL filter to Prisma where clause. In the trash view the status filter
  // doesn't apply (we want every recently-deleted request) — only deletedAt.
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
  const leaveSelect = {
    id: true,
    startDate: true,
    endDate: true,
    reason: true,
    status: true,
    reviewNote: true,
    reviewedAt: true,
    createdAt: true,
    attachmentUrl: true,
    deletedAt: true,
    deleteReason: true,
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
  } as const;

  const [rows, holidays] = await Promise.all([
    isTrash
      ? prismaRaw.leaveRequest.findMany({
          where: { deletedAt: { not: null } },
          orderBy: { deletedAt: 'desc' },
          take: 100,
          select: leaveSelect,
        })
      : prisma.leaveRequest.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: 100,
          select: leaveSelect,
        }),
    prisma.holiday.findMany({
      where: { archivedAt: null },
      select: { date: true, name: true },
    }),
  ]);

  // Bulk-sign attachment storage keys so the admin sees medical-cert
  // thumbnails inline while reviewing. Legacy URL strings (pre-A3,
  // shouldn't exist yet) pass through untouched.
  const attachmentKeys = rows
    .map((r) => r.attachmentUrl)
    .filter((v): v is string => !!v && v.length > 0 && !/^https?:\/\//i.test(v));
  const signedAttachmentUrls = await signAttendancePhotoUrls(attachmentKeys);
  function resolveAttachment(value: string | null): string | null {
    if (!value) return null;
    if (/^https?:\/\//i.test(value)) return value;
    return signedAttachmentUrls.get(value) ?? null;
  }

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb="คำขอลา"
        title="คำขอลา"
        subtitle="ตรวจสอบและอนุมัติคำขอลา — อนุมัติแล้วระบบจะสร้างรายการลงเวลา (OnLeave) อัตโนมัติ"
      />

      {/* Filter chips + trash toggle */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTER_OPTIONS.map((opt) => {
          const active = !isTrash && ((opt.value === '' && !status) || opt.value === status);
          return (
            <Link
              key={opt.value || 'pending'}
              href={opt.value ? `/admin/leave?status=${opt.value}` : '/admin/leave'}
              className={
                active
                  ? 'rounded-lg bg-primary-50 px-3 py-1.5 text-xs font-semibold text-primary-700 ring-1 ring-primary-200'
                  : 'rounded-lg px-3 py-1.5 text-xs font-semibold text-ink-4 hover:bg-gray-50 hover:text-ink-2'
              }
            >
              {opt.label}
            </Link>
          );
        })}
        <span className="mx-1 h-4 w-px bg-gray-200" aria-hidden="true" />
        <Link
          href="/admin/leave?trash=1"
          className={
            isTrash
              ? 'rounded-lg bg-primary-50 px-3 py-1.5 text-xs font-semibold text-primary-700 ring-1 ring-primary-200'
              : 'rounded-lg px-3 py-1.5 text-xs font-semibold text-ink-4 hover:bg-gray-50 hover:text-ink-2'
          }
        >
          🗑️ ถังขยะ
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            ทั้งหมด <span className="tabular-nums text-ink-3">({rows.length})</span>
          </CardTitle>
        </CardHeader>
        <CardBody className="!p-0">
          {rows.length === 0 ? (
            <EmptyState
              title={
                isTrash
                  ? 'ถังขยะว่าง'
                  : !status || status === 'pending'
                    ? 'ไม่มีคำขอลาที่รออนุมัติ ✨'
                    : 'ไม่มีรายการในตัวกรองนี้'
              }
              hint={isTrash ? 'ไม่มีคำขอลาที่ถูกลบ' : undefined}
            />
          ) : (
            <ul className="divide-y divide-gray-100">
              {(() => {
                // Pre-expand holidays once (auto-add Sun→Mon substitutes).
                // Computed once outside the per-row loop since the full
                // holiday list doesn't depend on the row.
                const expandedHolidays = expandHolidaysWithSubstitutes(holidays.map((h) => h.date));
                return rows.map((r) => {
                  const info = STATUS_INFO[r.status] ?? {
                    label: r.status,
                    key: 'neutral' as StatusKey,
                  };
                  const wd = workingDaysIn({
                    startDate: r.startDate,
                    endDate: r.endDate,
                    holidays: expandedHolidays,
                  });
                  return (
                    <li key={r.id} className="px-5 py-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <StatusBadge status={info.key}>{info.label}</StatusBadge>
                            <p className="truncate text-sm font-medium text-ink-1">
                              {r.employee.firstName} {r.employee.lastName}
                              {r.employee.nickname && (
                                <span className="text-ink-3"> ({r.employee.nickname})</span>
                              )}
                            </p>
                          </div>
                          <p className="mt-1 text-xs text-ink-3">
                            {r.employee.branch.name}
                            {r.employee.department ? ` • ${r.employee.department.name}` : ''}
                          </p>
                        </div>
                        <div className="text-left text-xs text-ink-2 sm:max-w-[300px] sm:text-right">
                          <p>
                            <strong>{r.leaveType.name}</strong>{' '}
                            {r.leaveType.isPaid ? '' : <span className="text-ink-3">(ไม่จ่าย)</span>}
                          </p>
                          <p className="mt-0.5 text-ink-3">
                            {formatRange(r.startDate, r.endDate)} • {wd.length} วันทำงาน
                          </p>
                          <p className="mt-0.5 text-[10px] text-ink-4">
                            ส่งเมื่อ {formatDateTime(r.createdAt)}
                          </p>
                        </div>
                      </div>

                      <p className="mt-3 line-clamp-3 whitespace-pre-wrap text-sm text-ink-2">
                        {r.reason}
                      </p>

                      {resolveAttachment(r.attachmentUrl) && (
                        <a
                          href={resolveAttachment(r.attachmentUrl) ?? '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 inline-block overflow-hidden rounded-lg border border-gray-200 transition hover:opacity-90"
                        >
                          {/* biome-ignore lint/performance/noImgElement: signed-URL preview */}
                          <img
                            src={resolveAttachment(r.attachmentUrl) ?? ''}
                            alt="ไฟล์แนบ"
                            className="block h-24 w-24 object-cover"
                            loading="lazy"
                          />
                        </a>
                      )}

                      {isTrash ? (
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-ink-3">
                          <span>
                            {r.deleteReason && (
                              <>
                                <strong className="text-ink-1">เหตุผลที่ลบ:</strong> {r.deleteReason}
                              </>
                            )}
                            {r.deletedAt && (
                              <span className="ml-2 text-ink-4">
                                ({formatDateTime(r.deletedAt)})
                              </span>
                            )}
                          </span>
                          <RestoreButton
                            action={async () => {
                              'use server';
                              return restoreLeaveRequest(r.id);
                            }}
                          />
                        </div>
                      ) : (
                        <>
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
                            <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-xs text-ink-2">
                              <strong className="text-ink-1">หมายเหตุ:</strong> {r.reviewNote}
                              {r.reviewedAt && (
                                <span className="ml-2 text-ink-4">
                                  ({formatDateTime(r.reviewedAt)})
                                </span>
                              )}
                            </div>
                          ) : null}
                          <div className="mt-2 flex justify-end">
                            <VoidDialog
                              triggerLabel="ลบ"
                              title="ลบคำขอลา"
                              description="คำขอลานี้และรายการลงเวลา (OnLeave) ที่สร้างขึ้นจะถูกลบทั้งหมด — กู้คืนได้ภายหลัง"
                              action={async (reason) => {
                                'use server';
                                return voidLeaveRequest(r.id, reason);
                              }}
                            />
                          </div>
                        </>
                      )}
                    </li>
                  );
                });
              })()}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
