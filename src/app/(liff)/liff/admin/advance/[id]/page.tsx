/**
 * /liff/admin/advance/[id] — mobile advance review + slip attach.
 *
 * Three states:
 *   Pending                 → approve / reject (client actions)
 *   Approved && paidAt=null → slip upload block (client)
 *   paidAt != null          → slip display + re-upload
 *
 * Balance context comes from advanceBalanceFor — the same helper the web
 * review modal's guard uses, so the numbers can never disagree.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { advanceBalanceFor } from '@/lib/advance/available';
import { isOverCap } from '@/lib/advance/balance';
import { getPermittedBranches } from '@/lib/auth/branch-scope';
import { requireLiffAdmin } from '@/lib/auth/require-liff-admin';
import type { Locale } from '@/lib/i18n/config';
import { resolveStoredImageUrl } from '@/lib/storage/signed-urls';
import { loadLiffAdvanceDetail } from './_load';
import { AdvanceReviewActions, MarkPaidButton, SlipUploadBlock } from './advance-review-actions';

type Params = Promise<{ id: string }>;

// Status → i18n key (resolved via t() at render) + badge class.
const STATUS_INFO: Record<string, { labelKey: string; cls: string }> = {
  Pending: { labelKey: 'statusPending', cls: 'bg-amber-100 text-amber-800' },
  Approved: { labelKey: 'statusApproved', cls: 'bg-green-100 text-green-800' },
  Rejected: { labelKey: 'statusRejected', cls: 'bg-red-100 text-red-800' },
  Cancelled: { labelKey: 'statusCancelled', cls: 'bg-gray-100 text-gray-700' },
};

function formatBkk(d: Date, locale: Locale): string {
  return d.toLocaleString(locale, {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function baht(n: number): string {
  return `฿${n.toLocaleString('th-TH')}`;
}

export default async function LiffAdminAdvanceDetailPage({ params }: { params: Params }) {
  const { id } = await params;
  const { user } = await requireLiffAdmin();
  const permitted = await getPermittedBranches(user, 'advance.read');

  // Branch-scoped by-id read (extracted to `_load` so the existence-hide is
  // testable — an out-of-branch id returns null → notFound).
  const row = await loadLiffAdvanceDetail(id, permitted);
  if (!row || row.deletedAt) notFound();

  // Exclude this advance from "reserved" when it's still Pending — same as
  // the web approval guard (it shouldn't count against itself).
  const balance = await advanceBalanceFor(
    row.employeeId,
    row.status === 'Pending' ? row.id : undefined,
  );
  const amount = Number(row.amount);
  const overCap = row.status === 'Pending' && isOverCap(amount, balance.available);

  const [t, locale] = await Promise.all([
    getTranslations('liffAdmin.advanceDetail'),
    getLocale() as Promise<Locale>,
  ]);

  const statusInfo = STATUS_INFO[row.status];
  const statusCls = statusInfo?.cls ?? 'bg-gray-100 text-gray-700';
  const statusLabel = statusInfo ? t(statusInfo.labelKey) : row.status;
  const name = `${row.employee.firstName} ${row.employee.lastName}`.trim();

  // receiptUrl: storage key → signed URL (renderable <img>); legacy
  // http(s) URL → passthrough, rendered as a plain link (no hotlinking).
  const receiptIsExternal = !!row.receiptUrl && /^https?:\/\//i.test(row.receiptUrl);
  const resolvedReceiptUrl = await resolveStoredImageUrl(row.receiptUrl);

  const awaitingSlip = row.status === 'Approved' && row.paidAt === null;
  const paid = row.paidAt !== null;

  return (
    <main className="px-4 pt-4 pb-12">
      <header className="mb-4">
        <Link
          href={
            awaitingSlip || paid
              ? '/liff/admin/advance?filter=awaiting-slip'
              : '/liff/admin/advance'
          }
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          {t('back')}
        </Link>
        <div className="mt-3 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-gray-900">{t('title')}</h1>
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusCls}`}>
            {paid ? t('statusTransferred') : statusLabel}
          </span>
        </div>
      </header>

      <section className="rounded-xl border border-gray-200 bg-white p-4 text-center shadow-sm">
        <p className="text-sm font-medium text-gray-900">
          {name}
          {row.employee.nickname && (
            <span className="text-gray-500"> ({row.employee.nickname})</span>
          )}
        </p>
        <p className="mt-2 text-3xl font-bold tabular-nums text-gray-900">{baht(amount)}</p>
        <p className="mt-1 text-xs text-gray-500">
          {t('submittedAt', { datetime: formatBkk(row.requestedAt, locale) })}
        </p>
        {row.approvedAt && (
          <p className="mt-0.5 text-xs text-gray-500">
            {t('approvedAt', { datetime: formatBkk(row.approvedAt, locale) })}
          </p>
        )}
        {row.paidAt && (
          <p className="mt-0.5 text-xs text-green-700">
            {t('transferredAt', { datetime: formatBkk(row.paidAt, locale) })}
          </p>
        )}
      </section>

      <section className="mt-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-xs font-medium uppercase tracking-wide text-gray-500">
          {t('creditTitle')}
        </h2>
        <dl className="mt-2 space-y-2 text-sm">
          {balance.kind === 'monthly' ? (
            <BalanceRow label={t('salary')}>{baht(balance.baseSalary)}</BalanceRow>
          ) : (
            <BalanceRow label={t('periodEarnings')}>
              {balance.earnings === null ? '—' : baht(balance.earnings)}
            </BalanceRow>
          )}
          <BalanceRow label={t('reserved')}>{baht(balance.reserved)}</BalanceRow>
          <BalanceRow label={t('available')}>
            {balance.available === null ? (
              '—'
            ) : (
              <span className={balance.available < 0 ? 'text-red-600' : 'text-gray-900'}>
                {baht(balance.available)}
              </span>
            )}
          </BalanceRow>
        </dl>
        {overCap && (
          <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">{t('overCap')}</p>
        )}
      </section>

      {row.status === 'Pending' && <AdvanceReviewActions cashAdvanceId={row.id} />}

      {/* Approved onward only. On a still-Pending request a "โอนเข้าบัญชี"
          heading with an account number reads as an instruction to transfer
          now, before anyone has approved it. */}
      {(awaitingSlip || paid) && (
        <section className="mt-3 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-xs font-medium uppercase tracking-wide text-gray-500">
            {t('payoutAccount')}
          </h2>
          {row.employee.bankAccountNumber ? (
            <dl className="mt-2 space-y-1 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-gray-500">{t('payoutBank')}</dt>
                <dd className="font-medium">
                  {row.employee.bank?.nameTh ?? row.employee.bank?.shortName ?? '—'}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-gray-500">{t('payoutAccountNo')}</dt>
                <dd className="font-medium tabular-nums">{row.employee.bankAccountNumber}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-gray-500">{t('payoutAccountName')}</dt>
                <dd className="font-medium">{row.employee.bankAccountName ?? '—'}</dd>
              </div>
            </dl>
          ) : (
            // Never render an empty block: the payer must be able to tell
            // "no data entered" apart from "the screen is broken".
            <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
              {t('payoutAccountMissing')}
            </p>
          )}
        </section>
      )}

      {awaitingSlip && (
        <>
          <MarkPaidButton cashAdvanceId={row.id} label={t('markPaidButton')} />
          <SlipUploadBlock
            cashAdvanceId={row.id}
            heading={t('attachSlipHeading')}
            buttonLabel={t('attachSlipButton')}
          />
        </>
      )}

      {paid && (
        <>
          <section className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
            <h2 className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {t('slipSection')}
            </h2>
            {receiptIsExternal && resolvedReceiptUrl ? (
              // Legacy web path stored an external URL — link, don't hotlink.
              <a
                href={resolvedReceiptUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 block text-sm font-medium text-primary-700 underline"
              >
                {t('openExternalSlip')}
              </a>
            ) : resolvedReceiptUrl ? (
              <a
                href={resolvedReceiptUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 block overflow-hidden rounded-lg border border-gray-200 transition hover:opacity-90"
              >
                {/* biome-ignore lint/performance/noImgElement: signed URL, short TTL — next/image can't optimize it */}
                <img src={resolvedReceiptUrl} alt={t('slipAlt')} className="w-full" />
              </a>
            ) : row.receiptUrl ? (
              // A slip key IS on record but failed to resolve to a viewable
              // URL — that's genuinely broken, distinct from "never attached".
              <p className="mt-2 text-sm text-gray-500">{t('noSlipFile')}</p>
            ) : (
              // Paid-with-no-slip is a normal, possibly permanent state (the
              // slip is optional) — must read as "nothing here yet", not
              // "the screen is broken".
              <p className="mt-2 text-sm text-gray-500">{t('noSlipYet')}</p>
            )}
          </section>
          <SlipUploadBlock
            cashAdvanceId={row.id}
            heading={row.receiptUrl ? t('reattachHeading') : t('attachSlipHeading')}
            buttonLabel={row.receiptUrl ? t('reattachButton') : t('attachSlipButton')}
          />
        </>
      )}
    </main>
  );
}

function BalanceRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-xs text-gray-500">{label}</dt>
      <dd className="text-right tabular-nums text-gray-900">{children}</dd>
    </div>
  );
}
