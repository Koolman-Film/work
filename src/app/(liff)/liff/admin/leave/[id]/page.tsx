/**
 * /liff/admin/leave/[id] — mobile leave-request review for paired admins.
 *
 * Reuses the admin web inbox's view-model builders (LEAVE_SELECT,
 * buildLeaveRowVM, leaveOverQuotaVM) so the quota/deduction preview shows
 * the SAME numbers as the web review modal. Pending → mount the client
 * approve/reject actions; decided → read-only badge + review note.
 *
 * The static chrome (labels, headings, buttons) is localized via the
 * `liffAdmin` namespace. The VM-derived values (status label, leave-type name,
 * duration/range text) come from the Thai-only web admin view-model and are
 * rendered as-is — translating them belongs to the web admin i18n effort.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  buildLeaveRowVM,
  LEAVE_STATUS_INFO,
  leaveOverQuotaVM,
} from '@/app/(admin)/admin/leave/leave-row-vm';
import { getPermittedBranches } from '@/lib/auth/branch-scope';
import { requireLiffAdmin } from '@/lib/auth/require-liff-admin';
import { prisma } from '@/lib/db/prisma';
import { getLeaveConfig } from '@/lib/leave/leave-config';
import { expandHolidaysWithSubstitutes, workingDaysIn } from '@/lib/leave/working-days';
import { resolveStoredImageUrl } from '@/lib/storage/signed-urls';
import { loadLiffLeaveDetail } from './_load';
import { LeaveReviewActions } from './leave-review-actions';

type Params = Promise<{ id: string }>;

const STATUS_CLS: Record<string, string> = {
  Pending: 'bg-amber-100 text-amber-800',
  Approved: 'bg-green-100 text-green-800',
  Rejected: 'bg-red-100 text-red-800',
  Cancelled: 'bg-surface-sunken text-ink-2',
};

export default async function LiffAdminLeaveDetailPage({ params }: { params: Params }) {
  const { id } = await params;
  const { user } = await requireLiffAdmin();
  const permitted = await getPermittedBranches(user, 'leave.read');

  // Branch-scoped by-id read (extracted to `_load` so the existence-hide is
  // testable — an out-of-branch id returns null → notFound).
  const [row, holidays, leaveCfg] = await Promise.all([
    loadLiffLeaveDetail(id, permitted),
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
  // Status label comes from the Thai-only web admin VM (see file header).
  const statusLabel = LEAVE_STATUS_INFO[vm.status]?.label ?? vm.status;

  const t = await getTranslations('liffAdmin.leaveDetail');

  return (
    <main className="px-4 pt-4 pb-12">
      <header className="mb-4">
        <Link href="/liff/admin/inbox" className="text-sm text-ink-3 hover:text-ink-2">
          {t('back')}
        </Link>
        <div className="mt-3 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-ink-1">{t('title')}</h1>
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${cls}`}>
            {statusLabel}
          </span>
        </div>
      </header>

      <section className="rounded-xl border border-line bg-surface p-4 shadow-sm">
        <p className="text-sm font-medium text-ink-1">
          {vm.name}
          {vm.nickname && <span className="text-ink-3"> ({vm.nickname})</span>}
        </p>
        <p className="mt-0.5 text-xs text-ink-3">
          {vm.branch}
          {vm.department ? ` • ${vm.department}` : ''}
        </p>
        <dl className="mt-3 space-y-2 border-t border-line-soft pt-3 text-sm">
          <Row label={t('type')}>
            {vm.leaveType}
            {vm.isPaid ? '' : t('unpaidSuffix')}
          </Row>
          <Row label={t('dateRange')}>{vm.range}</Row>
          <Row label={t('duration')}>{vm.durationLabel}</Row>
          <Row label={t('submittedAt')}>{vm.submitted}</Row>
          <Row label={t('reason')}>{vm.reason}</Row>
        </dl>
      </section>

      {vm.overQuota && (
        <section className="mt-3 rounded-xl border border-line bg-surface p-4 shadow-sm">
          <h2 className="text-xs font-medium uppercase tracking-wide text-ink-3">
            {t('quotaTitle')}
          </h2>
          <dl className="mt-2 space-y-2 text-sm">
            <Row label={t('remaining')}>{vm.overQuota.remainingLabel}</Row>
            {vm.overQuota.overLabel && (
              <Row label={t('overQuota')}>
                <span className="text-red-600">{vm.overQuota.overLabel}</span>
              </Row>
            )}
            {vm.overQuota.estimatedDeduction > 0 && (
              <Row label={t('estimatedDeduction')}>
                <span className="text-red-600">
                  ฿{vm.overQuota.estimatedDeduction.toLocaleString('th-TH')}
                </span>
              </Row>
            )}
          </dl>
          {vm.overQuota.blocksApproval && (
            <p className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">
              {t('blockApproval')}
            </p>
          )}
        </section>
      )}

      {vm.attachmentUrl && (
        <section className="mt-3 rounded-xl border border-line bg-surface-muted p-4">
          <h2 className="text-xs font-medium uppercase tracking-wide text-ink-3">
            {t('attachment')}
          </h2>
          <a
            href={vm.attachmentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 block overflow-hidden rounded-lg border border-line transition hover:opacity-90"
          >
            {/* biome-ignore lint/performance/noImgElement: signed URL, short TTL — next/image can't optimize it */}
            <img src={vm.attachmentUrl} alt={t('attachmentAlt')} className="w-full" />
          </a>
        </section>
      )}

      {vm.status === 'Pending' ? (
        <LeaveReviewActions
          leaveRequestId={vm.id}
          approveBlocked={vm.overQuota?.blocksApproval ?? false}
        />
      ) : (
        <section className="mt-3 rounded-xl border border-line bg-surface p-4 shadow-sm">
          <h2 className="text-xs font-medium uppercase tracking-wide text-ink-3">
            {t('reviewResult')}
          </h2>
          <dl className="mt-2 space-y-2 text-sm">
            {vm.reviewedAt && <Row label={t('reviewedAt')}>{vm.reviewedAt}</Row>}
            {vm.reviewNote && <Row label={t('note')}>{vm.reviewNote}</Row>}
          </dl>
        </section>
      )}
    </main>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-xs text-ink-3">{label}</dt>
      <dd className="text-right text-ink-1">{children}</dd>
    </div>
  );
}
