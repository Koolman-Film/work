/**
 * /liff/admin/leave/[id] — mobile leave-request review for paired admins.
 *
 * Reuses the admin web inbox's view-model builders (LEAVE_SELECT,
 * buildLeaveRowVM, leaveOverQuotaVM) so the quota/deduction preview shows
 * the SAME numbers as the web review modal. Pending → mount the client
 * approve/reject actions; decided → read-only badge + review note.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  buildLeaveRowVM,
  LEAVE_SELECT,
  LEAVE_STATUS_INFO,
  leaveOverQuotaVM,
} from '@/app/(admin)/admin/leave/leave-row-vm';
import { getPermittedBranches, viaEmployeeBranchScope } from '@/lib/auth/branch-scope';
import { requireLiffAdmin } from '@/lib/auth/require-liff-admin';
import { prisma } from '@/lib/db/prisma';
import { getLeaveConfig } from '@/lib/leave/leave-config';
import { expandHolidaysWithSubstitutes, workingDaysIn } from '@/lib/leave/working-days';
import { resolveStoredImageUrl } from '@/lib/storage/signed-urls';
import { LeaveReviewActions } from './leave-review-actions';

type Params = Promise<{ id: string }>;

const STATUS_CLS: Record<string, string> = {
  Pending: 'bg-amber-100 text-amber-800',
  Approved: 'bg-green-100 text-green-800',
  Rejected: 'bg-red-100 text-red-800',
  Cancelled: 'bg-gray-100 text-gray-700',
};

export default async function LiffAdminLeaveDetailPage({ params }: { params: Params }) {
  const { id } = await params;
  const { user } = await requireLiffAdmin();
  const permitted = await getPermittedBranches(user, 'leave.read');

  const [row, holidays, leaveCfg] = await Promise.all([
    prisma.leaveRequest.findFirst({
      where: { id, ...viaEmployeeBranchScope(permitted) },
      select: LEAVE_SELECT,
    }),
    prisma.holiday.findMany({ where: { archivedAt: null }, select: { date: true } }),
    getLeaveConfig(),
  ]);
  if (!row) notFound();

  const workingDays = workingDaysIn({
    startDate: row.startDate,
    endDate: row.endDate,
    holidays: expandHolidaysWithSubstitutes(holidays.map((h) => h.date)),
  }).length;

  const vm = buildLeaveRowVM(row, {
    attachmentUrl: await resolveStoredImageUrl(row.attachmentUrl),
    workingDays,
    cfg: leaveCfg,
    overQuota: await leaveOverQuotaVM(row, workingDays, leaveCfg),
  });

  const cls = STATUS_CLS[vm.status] ?? STATUS_CLS.Pending;
  const statusLabel = LEAVE_STATUS_INFO[vm.status]?.label ?? vm.status;

  return (
    <main className="px-4 pt-4 pb-12">
      <header className="mb-4">
        <Link href="/liff/admin/inbox" className="text-sm text-gray-500 hover:text-gray-700">
          ← กลับไปงานรออนุมัติ
        </Link>
        <div className="mt-3 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-gray-900">คำขอลา</h1>
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${cls}`}>
            {statusLabel}
          </span>
        </div>
      </header>

      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-medium text-gray-900">
          {vm.name}
          {vm.nickname && <span className="text-gray-500"> ({vm.nickname})</span>}
        </p>
        <p className="mt-0.5 text-xs text-gray-500">
          {vm.branch}
          {vm.department ? ` • ${vm.department}` : ''}
        </p>
        <dl className="mt-3 space-y-2 border-t border-gray-100 pt-3 text-sm">
          <Row label="ประเภท">
            {vm.leaveType}
            {vm.isPaid ? '' : ' (ไม่จ่าย)'}
          </Row>
          <Row label="ช่วงวันที่">{vm.range}</Row>
          <Row label="ระยะเวลา">{vm.durationLabel}</Row>
          <Row label="ส่งเมื่อ">{vm.submitted}</Row>
          <Row label="เหตุผล">{vm.reason}</Row>
        </dl>
      </section>

      {vm.overQuota && (
        <section className="mt-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="text-xs font-medium uppercase tracking-wide text-gray-500">โควต้าคงเหลือ</h2>
          <dl className="mt-2 space-y-2 text-sm">
            <Row label="คงเหลือ">{vm.overQuota.remainingLabel}</Row>
            {vm.overQuota.overLabel && (
              <Row label="เกินโควต้า">
                <span className="text-red-600">{vm.overQuota.overLabel}</span>
              </Row>
            )}
            {vm.overQuota.estimatedDeduction > 0 && (
              <Row label="หักเงินโดยประมาณ">
                <span className="text-red-600">
                  ฿{vm.overQuota.estimatedDeduction.toLocaleString('th-TH')}
                </span>
              </Row>
            )}
          </dl>
          {vm.overQuota.blocksApproval && (
            <p className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">
              เกินโควต้า (นโยบาย: ห้ามอนุมัติ) — ไม่สามารถอนุมัติคำขอนี้ได้
            </p>
          )}
        </section>
      )}

      {vm.attachmentUrl && (
        <section className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
          <h2 className="text-xs font-medium uppercase tracking-wide text-gray-500">เอกสารแนบ</h2>
          <a
            href={vm.attachmentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 block overflow-hidden rounded-lg border border-gray-200 transition hover:opacity-90"
          >
            {/* biome-ignore lint/performance/noImgElement: signed URL, short TTL — next/image can't optimize it */}
            <img src={vm.attachmentUrl} alt="เอกสารแนบ" className="w-full" />
          </a>
        </section>
      )}

      {vm.status === 'Pending' ? (
        <LeaveReviewActions
          leaveRequestId={vm.id}
          approveBlocked={vm.overQuota?.blocksApproval ?? false}
        />
      ) : (
        <section className="mt-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="text-xs font-medium uppercase tracking-wide text-gray-500">
            ผลการตรวจสอบ
          </h2>
          <dl className="mt-2 space-y-2 text-sm">
            {vm.reviewedAt && <Row label="ตรวจสอบเมื่อ">{vm.reviewedAt}</Row>}
            {vm.reviewNote && <Row label="หมายเหตุ">{vm.reviewNote}</Row>}
          </dl>
        </section>
      )}
    </main>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-xs text-gray-500">{label}</dt>
      <dd className="text-right text-gray-900">{children}</dd>
    </div>
  );
}
