/**
 * /liff/admin/dispute/[id] — mobile review of a flagged (Disputed) check-in.
 * Shows the selfie + location + reason; Disputed → approve/reject actions,
 * decided → read-only. Reuses approveDisputed/rejectDisputed via the client
 * actions component.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { requireLiffAdmin } from '@/lib/auth/require-liff-admin';
import { prisma } from '@/lib/db/prisma';
import type { Locale } from '@/lib/i18n/config';
import { resolveStoredImageUrl } from '@/lib/storage/signed-urls';
import { DisputeReviewActions } from './dispute-review-actions';

type Params = Promise<{ id: string }>;

const fmtTime = (d: Date | null, locale: Locale) =>
  d
    ? d.toLocaleString(locale, {
        timeZone: 'Asia/Bangkok',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

export default async function LiffAdminDisputeDetailPage({ params }: { params: Params }) {
  const { id } = await params;
  await requireLiffAdmin();

  const row = await prisma.attendance.findUnique({
    where: { id },
    select: {
      id: true,
      clockInAt: true,
      checkInStatus: true,
      disputeReason: true,
      checkInSelfieUrl: true,
      checkInLat: true,
      checkInLng: true,
      employee: { select: { firstName: true, lastName: true, nickname: true } },
      checkInBranch: { select: { name: true } },
    },
  });
  if (!row) notFound();

  const selfieUrl = await resolveStoredImageUrl(row.checkInSelfieUrl);
  const isPending = row.checkInStatus === 'Disputed';
  const lat = row.checkInLat?.toString();
  const lng = row.checkInLng?.toString();
  const name = `${row.employee.firstName} ${row.employee.lastName}`.trim();

  const [t, locale] = await Promise.all([
    getTranslations('liffAdmin.disputeDetail'),
    getLocale() as Promise<Locale>,
  ]);

  return (
    <main className="px-4 pt-4 pb-12">
      <header className="mb-4">
        <Link href="/liff/admin/inbox" className="text-sm text-ink-3 hover:text-ink-2">
          {t('back')}
        </Link>
        <div className="mt-3 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-ink-1">{t('title')}</h1>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              isPending ? 'bg-amber-100 text-amber-800' : 'bg-surface-sunken text-ink-2'
            }`}
          >
            {isPending ? t('statusPending') : t('statusReviewed')}
          </span>
        </div>
      </header>

      <section className="rounded-xl border border-line bg-surface p-4 shadow-sm">
        <p className="text-sm font-medium text-ink-1">
          {name}
          {row.employee.nickname && <span className="text-ink-3"> ({row.employee.nickname})</span>}
        </p>
        <dl className="mt-3 space-y-2 border-t border-line-soft pt-3 text-sm">
          <Row label={t('checkinTime')}>{fmtTime(row.clockInAt, locale)}</Row>
          {row.checkInBranch && <Row label={t('branch')}>{row.checkInBranch.name}</Row>}
          {row.disputeReason && (
            <Row label={t('disputeReason')}>
              <span className="text-amber-700">{row.disputeReason}</span>
            </Row>
          )}
          {lat && lng && (
            <Row label={t('location')}>
              <a
                href={`https://www.google.com/maps?q=${lat},${lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-600 underline"
              >
                {t('openMap')}
              </a>
            </Row>
          )}
        </dl>
      </section>

      {selfieUrl && (
        <section className="mt-3 rounded-xl border border-line bg-surface-muted p-4">
          <h2 className="text-xs font-medium uppercase tracking-wide text-ink-3">
            {t('selfieSection')}
          </h2>
          <a
            href={selfieUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 block overflow-hidden rounded-lg border border-line transition hover:opacity-90"
          >
            {/* biome-ignore lint/performance/noImgElement: signed URL, short TTL — next/image can't optimize it */}
            <img src={selfieUrl} alt={t('selfieAlt')} className="w-full" />
          </a>
        </section>
      )}

      {isPending ? (
        <DisputeReviewActions attendanceId={row.id} />
      ) : (
        <section className="mt-3 rounded-xl border border-line bg-surface p-4 text-sm text-ink-2 shadow-sm">
          {t('alreadyReviewed')}
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
