/**
 * /admin/leave — leave-request inbox.
 *
 * Default view: only Pending requests, newest-submitted first. Status
 * filter chips (?status=Approved|Rejected|All) let admins look at history;
 * ?trash=1 shows recently soft-deleted requests with a Restore action.
 *
 * Each row is a button that opens a focused review modal (ReviewModal):
 * facts + the employee's reason + medical-cert attachment + a required note
 * + Approve / Reject (and a void action). Approving runs the $transaction
 * that expands the request into Attendance(OnLeave) rows.
 */

import Link from 'next/link';
import { RestoreButton } from '@/components/admin/void-dialog';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge, type StatusKey } from '@/components/ui/status-badge';
import { prisma, prismaRaw } from '@/lib/db/prisma';
import { getLeaveConfig } from '@/lib/leave/leave-config';
import { leaveDurationLabel } from '@/lib/leave/units';
import { restoreLeaveRequest } from '@/lib/leave/void';
import { expandHolidaysWithSubstitutes, workingDaysIn } from '@/lib/leave/working-days';
import { signAttendancePhotoUrls } from '@/lib/storage/signed-urls';
import { LeaveInbox, type LeaveRowVM } from './leave-inbox';
import {
  buildLeaveRowVM,
  formatLeaveDateTime,
  formatLeaveRange,
  LEAVE_SELECT,
  LEAVE_STATUS_INFO,
} from './leave-row-vm';

type SearchParams = Promise<{ status?: string; trash?: string }>;

const FILTER_OPTIONS = [
  { value: '', label: 'รออนุมัติ' },
  { value: 'all', label: 'ทั้งหมด' },
  { value: 'approved', label: 'อนุมัติแล้ว' },
  { value: 'rejected', label: 'ไม่อนุมัติ' },
] as const;

export default async function AdminLeaveInboxPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { status, trash } = await searchParams;
  const isTrash = trash === '1';

  const where = (() => {
    if (status === 'all') return {};
    if (status === 'approved') return { status: 'Approved' as const };
    if (status === 'rejected') return { status: 'Rejected' as const };
    return { status: 'Pending' as const };
  })();

  const [rows, holidays, leaveCfg] = await Promise.all([
    isTrash
      ? prismaRaw.leaveRequest.findMany({
          where: { deletedAt: { not: null } },
          orderBy: { deletedAt: 'desc' },
          take: 100,
          select: LEAVE_SELECT,
        })
      : prisma.leaveRequest.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: 100,
          select: LEAVE_SELECT,
        }),
    prisma.holiday.findMany({
      where: { archivedAt: null },
      select: { date: true, name: true },
    }),
    getLeaveConfig(),
  ]);

  const attachmentKeys = rows
    .map((r) => r.attachmentUrl)
    .filter((v): v is string => !!v && v.length > 0 && !/^https?:\/\//i.test(v));
  const signedAttachmentUrls = await signAttendancePhotoUrls(attachmentKeys);
  function resolveAttachment(value: string | null): string | null {
    if (!value) return null;
    if (/^https?:\/\//i.test(value)) return value;
    return signedAttachmentUrls.get(value) ?? null;
  }

  // View-model for the interactive (non-trash) list. The client LeaveInbox
  // renders each row as a button that opens the review modal.
  const expandedHolidays = expandHolidaysWithSubstitutes(holidays.map((h) => h.date));
  const vm: LeaveRowVM[] = isTrash
    ? []
    : rows.map((r) =>
        buildLeaveRowVM(r, {
          attachmentUrl: resolveAttachment(r.attachmentUrl),
          workingDays: workingDaysIn({
            startDate: r.startDate,
            endDate: r.endDate,
            holidays: expandedHolidays,
          }).length,
          cfg: leaveCfg,
        }),
      );

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
        {/* Record leave on behalf of an employee — the only path that allows
            back-dating beyond the worker self-file window. */}
        <Link
          href="/admin/leave/new"
          className="ml-auto rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-primary-700"
        >
          + บันทึกการลา (ย้อนหลัง)
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
          ) : isTrash ? (
            <ul className="divide-y divide-gray-100">
              {rows.map((r) => {
                const info = LEAVE_STATUS_INFO[r.status] ?? {
                  label: r.status,
                  key: 'neutral' as StatusKey,
                };
                const wd = workingDaysIn({
                  startDate: r.startDate,
                  endDate: r.endDate,
                  holidays: expandedHolidays,
                });
                const attachment = resolveAttachment(r.attachmentUrl);
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
                          {formatLeaveRange(r.startDate, r.endDate)} •{' '}
                          {leaveDurationLabel(r.unit, wd.length, leaveCfg, r.startTime, r.endTime)}
                        </p>
                        <p className="mt-0.5 text-[10px] text-ink-4">
                          ส่งเมื่อ {formatLeaveDateTime(r.createdAt)}
                        </p>
                      </div>
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs text-ink-3">{r.reason}</p>
                    {attachment && (
                      <a
                        href={attachment}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-block overflow-hidden rounded-lg border border-gray-200 transition hover:opacity-90"
                      >
                        {/* biome-ignore lint/performance/noImgElement: signed-URL preview */}
                        <img
                          src={attachment}
                          alt="ไฟล์แนบ"
                          className="block h-20 w-20 object-cover"
                          loading="lazy"
                        />
                      </a>
                    )}
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-ink-3">
                      <span>
                        {r.deleteReason && (
                          <>
                            <strong className="text-ink-1">เหตุผลที่ลบ:</strong> {r.deleteReason}
                          </>
                        )}
                        {r.deletedAt && (
                          <span className="ml-2 text-ink-4">
                            ({formatLeaveDateTime(r.deletedAt)})
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
                  </li>
                );
              })}
            </ul>
          ) : (
            <LeaveInbox rows={vm} />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
