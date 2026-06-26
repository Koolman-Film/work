/**
 * /liff/leave/[id] — detail view of own leave request.
 *
 * Server-renders the read-only data and embeds a Client cancel button
 * if status is Pending. Admin-only fields (reviewedBy, reviewNote) are
 * surfaced verbatim because the employee deserves to see why their
 * request was rejected.
 *
 * Access control: only the request owner can view their own request.
 * Admins viewing leave requests use /admin/leave (W4c).
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { requireEmployee } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';
import type { Locale } from '@/lib/i18n/config';
import { formatDate, formatTime } from '@/lib/i18n/format';
import { localizedLeaveTypeName } from '@/lib/leave/localized-name';
import { resolveStoredImageUrl } from '@/lib/storage/signed-urls';
import { LeaveDetailActions } from './leave-detail-actions';

type Params = Promise<{ id: string }>;

const STATUS_CLS: Record<string, string> = {
  Pending: 'bg-amber-100 text-amber-800',
  Approved: 'bg-green-100 text-green-800',
  Rejected: 'bg-red-100 text-red-800',
  Cancelled: 'bg-gray-100 text-gray-700',
};

function formatDateTime(d: Date, locale: Locale): string {
  const datePart = formatDate(d, locale);
  const timePart = formatTime(d, locale);
  return `${datePart} ${timePart}`;
}

export default async function LeaveDetailPage({ params }: { params: Params }) {
  const { id } = await params;
  const { employee } = await requireEmployee();

  const [row, t, locale] = await Promise.all([
    prisma.leaveRequest.findUnique({
      where: { id },
      select: {
        id: true,
        employeeId: true,
        leaveType: { select: { name: true, nameByLocale: true, isPaid: true } },
        startDate: true,
        endDate: true,
        reason: true,
        status: true,
        reviewNote: true,
        reviewedAt: true,
        createdAt: true,
        attachmentUrl: true,
      },
    }),
    getTranslations('leave'),
    getLocale(),
  ]);

  if (!row) notFound();
  if (row.employeeId !== employee.id) notFound(); // not your request

  // attachmentUrl may be a Storage path or a legacy URL; resolve at
  // view-time so signed URLs always reflect a fresh TTL.
  const resolvedAttachmentUrl = await resolveStoredImageUrl(row.attachmentUrl);

  const cls = STATUS_CLS[row.status] ?? STATUS_CLS.Pending;
  const statusLabel = t(`status.${row.status}` as Parameters<typeof t>[0]);

  return (
    <main className="mx-auto max-w-md px-4 pt-8 pb-12">
      <header className="mb-6">
        <Link href="/liff/leave" className="text-sm text-gray-500 hover:text-gray-700">
          {t('detail.back')}
        </Link>
        <div className="mt-3 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-gray-900">{t('detail.title')}</h1>
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${cls}`}>
            {statusLabel}
          </span>
        </div>
      </header>

      <section className="space-y-1 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <DataRow label={t('detail.field.type')}>
          {localizedLeaveTypeName(row.leaveType.name, row.leaveType.nameByLocale, locale as Locale)}
          {!row.leaveType.isPaid && (
            <span className="ml-2 text-xs text-gray-500">{t('detail.unpaid')}</span>
          )}
        </DataRow>
        <DataRow label={t('detail.field.from')}>
          {formatDate(row.startDate, locale as Locale)}
        </DataRow>
        <DataRow label={t('detail.field.to')}>{formatDate(row.endDate, locale as Locale)}</DataRow>
        <DataRow label={t('detail.field.submittedAt')}>
          {formatDateTime(row.createdAt, locale as Locale)}
        </DataRow>
      </section>

      <section className="mt-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-xs font-medium uppercase tracking-wide text-gray-500">
          {t('detail.reasonHeading')}
        </h2>
        <p className="mt-2 whitespace-pre-wrap text-sm text-gray-800">{row.reason}</p>
      </section>

      {resolvedAttachmentUrl && (
        <section className="mt-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-xs font-medium uppercase tracking-wide text-gray-500">
            {t('detail.attachmentHeading')}
          </h2>
          <a
            href={resolvedAttachmentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 block overflow-hidden rounded-lg border border-gray-200 transition hover:opacity-90"
          >
            {/* biome-ignore lint/performance/noImgElement: signed-URL preview can't use next/image */}
            <img
              src={resolvedAttachmentUrl}
              alt={t('detail.attachmentAlt')}
              className="block h-auto w-full"
              loading="lazy"
            />
          </a>
        </section>
      )}

      {/* Admin review feedback, if any. */}
      {row.reviewNote && (
        <section className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-6">
          <h2 className="text-xs font-medium uppercase tracking-wide text-gray-500">
            {t('detail.adminNoteHeading')}
          </h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-gray-800">{row.reviewNote}</p>
          {row.reviewedAt && (
            <p className="mt-2 text-xs text-gray-400">
              {formatDateTime(row.reviewedAt, locale as Locale)}
            </p>
          )}
        </section>
      )}

      {/* Cancel button — only when Pending. */}
      {row.status === 'Pending' && (
        <section className="mt-6">
          <LeaveDetailActions leaveRequestId={row.id} />
        </section>
      )}
    </main>
  );
}

function DataRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between py-2 first:pt-0 last:pb-0">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-right text-sm font-medium text-gray-900">{children}</span>
    </div>
  );
}
