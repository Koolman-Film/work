/**
 * /liff/advance/[id] — detail view of own cash-advance request.
 *
 * Same shape as /liff/leave/[id]: read-only data block + cancel button
 * if Pending. CashAdvance lacks reviewNote so post-decision feedback is
 * limited — the audit log is the source of truth for the "why."
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';
import type { Locale } from '@/lib/i18n/config';
import { formatDate, formatMoney, formatTime } from '@/lib/i18n/format';
import { resolveStoredImageUrl } from '@/lib/storage/signed-urls';
import { AdvanceDetailActions } from './advance-detail-actions';

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

export default async function AdvanceDetailPage({ params }: { params: Params }) {
  const { id } = await params;
  const { employee } = await requireRole(['Staff']);
  if (!employee) throw new Error('requireRole did not return Employee');

  const [row, t, locale] = await Promise.all([
    prisma.cashAdvance.findUnique({
      where: { id },
      select: {
        id: true,
        employeeId: true,
        amount: true,
        status: true,
        requestedAt: true,
        approvedAt: true,
        paidAt: true,
        receiptUrl: true,
        isDeducted: true,
      },
    }),
    getTranslations('advance'),
    getLocale(),
  ]);

  if (!row) notFound();
  if (row.employeeId !== employee.id) notFound();

  // receiptUrl may be a Storage path (post-W4-late) or a legacy URL.
  // resolveStoredImageUrl returns a fresh signed URL in the first case,
  // pass-through in the second.
  const receiptIsExternal = !!row.receiptUrl && /^https?:\/\//i.test(row.receiptUrl);
  const resolvedReceiptUrl = await resolveStoredImageUrl(row.receiptUrl);

  const paid = row.paidAt !== null;
  const cls = STATUS_CLS[row.status] ?? STATUS_CLS.Pending;

  return (
    <main className="mx-auto max-w-md px-4 pt-8 pb-12">
      <header className="mb-6">
        <Link href="/liff/advance" className="text-sm text-gray-500 hover:text-gray-700">
          {t('detail.back')}
        </Link>
        <div className="mt-3 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-gray-900">{t('detail.title')}</h1>
          {paid ? (
            <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-800">
              {t('detail.paid')}
            </span>
          ) : (
            cls && (
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${cls}`}>
                {t(`status.${row.status}`)}
              </span>
            )
          )}
        </div>
      </header>

      <section className="rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm">
        <p className="text-xs text-gray-500">{t('detail.amountLabel')}</p>
        <p className="mt-2 text-3xl font-bold tabular-nums text-gray-900">
          {formatMoney(row.amount.toString(), locale as Locale)}
        </p>
      </section>

      <section className="mt-4 space-y-1 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <DataRow label={t('detail.field.submittedAt')}>
          {formatDateTime(row.requestedAt, locale as Locale)}
        </DataRow>
        {row.approvedAt && (
          <DataRow label={t('detail.field.decidedAt')}>
            {formatDateTime(row.approvedAt, locale as Locale)}
          </DataRow>
        )}
        {row.paidAt && (
          <DataRow label={t('detail.paid')}>
            <span className="text-green-700">{formatDateTime(row.paidAt, locale as Locale)}</span>
          </DataRow>
        )}
        {row.status === 'Approved' && (
          <DataRow label={t('detail.field.deductFromSalary')}>
            {row.isDeducted ? (
              <span className="text-gray-700">{t('detail.deducted')}</span>
            ) : (
              <span className="text-amber-700">{t('detail.notDeducted')}</span>
            )}
          </DataRow>
        )}
      </section>

      {resolvedReceiptUrl && (
        <section className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-6">
          <h2 className="text-xs font-medium uppercase tracking-wide text-gray-500">
            {paid ? t('detail.slip') : t('detail.receiptHeading')}
          </h2>
          {receiptIsExternal ? (
            // Legacy rows stored an external URL — link out, don't hotlink.
            <a
              href={resolvedReceiptUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 block text-sm font-medium text-primary-700 underline"
            >
              {paid ? t('detail.slip') : t('detail.receiptHeading')} →
            </a>
          ) : (
            <>
              <a
                href={resolvedReceiptUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 block overflow-hidden rounded-lg border border-gray-200 transition hover:opacity-90"
              >
                {/* biome-ignore lint/performance/noImgElement: signed-URL preview can't use next/image (short TTL + external storage origin) */}
                <img
                  src={resolvedReceiptUrl}
                  alt={paid ? t('detail.slip') : t('detail.receiptAlt')}
                  className="block h-auto w-full"
                  loading="lazy"
                />
              </a>
              <a
                href={resolvedReceiptUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-xs text-primary-700 underline hover:text-primary-800"
              >
                {t('detail.receiptFullSize')}
              </a>
            </>
          )}
        </section>
      )}

      {row.status === 'Pending' && (
        <section className="mt-6">
          <AdvanceDetailActions cashAdvanceId={row.id} />
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
