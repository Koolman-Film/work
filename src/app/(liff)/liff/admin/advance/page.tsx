/**
 * /liff/admin/advance — approved advances that still need attention on the
 * payment side: either the transfer hasn't happened yet (paidAt=null), or
 * it has but the slip is still missing (receiptUrl=null). Two distinct
 * states, one list — `awaitingSlipRowState` (in `_load.ts`) tells them
 * apart per row.
 *
 * Single-purpose by design: PENDING advances are NOT listed here — the
 * inbox (/liff/admin/inbox) owns everything that needs a decision. A
 * previous version duplicated a รออนุมัติ filter here, which put two
 * identically-labeled controls on screen with the shell tabs.
 *
 * The page title is the active shell tab (see admin-tabs.tsx) — no h1.
 */

import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { getPermittedBranches } from '@/lib/auth/branch-scope';
import { requireLiffAdmin } from '@/lib/auth/require-liff-admin';
import type { Locale } from '@/lib/i18n/config';
import { awaitingSlipRowState, loadAwaitingSlipRows } from './_load';

function formatBkk(d: Date, locale: Locale): string {
  return d.toLocaleString(locale, {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default async function LiffAdminAwaitingSlipPage() {
  const { user } = await requireLiffAdmin();
  const permitted = await getPermittedBranches(user, 'advance.read');

  const rows = await loadAwaitingSlipRows(permitted);

  const [t, locale] = await Promise.all([
    getTranslations('liffAdmin.awaitingSlip'),
    getLocale() as Promise<Locale>,
  ]);

  return (
    <main className="px-4 pt-4 pb-12">
      <p className="mb-4 text-sm text-ink-3">{t('intro')}</p>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface p-12 text-center">
          <p className="text-sm text-ink-3">{t('empty')}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const name = `${r.employee.firstName} ${r.employee.lastName}`.trim();
            const state = awaitingSlipRowState(r);
            const badgeText =
              state === 'awaiting-payment' ? t('badgeAwaitingPayment') : t('badgeAwaitingSlip');
            const badgeCls =
              state === 'awaiting-payment'
                ? 'bg-amber-100 text-amber-800'
                : 'bg-blue-100 text-blue-800';
            return (
              <li key={r.id}>
                <Link
                  href={`/liff/admin/advance/${r.id}`}
                  className="block rounded-xl border border-line bg-surface p-4 shadow-sm transition hover:border-primary-200 hover:bg-primary-50/30"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink-1">
                        {name}
                        {r.employee.nickname && (
                          <span className="text-ink-3"> ({r.employee.nickname})</span>
                        )}
                      </p>
                      <p className="mt-0.5 text-lg font-semibold tabular-nums text-ink-1">
                        ฿{Number(r.amount).toLocaleString('th-TH')}
                      </p>
                      {r.approvedAt && (
                        <p className="mt-0.5 text-[10px] text-ink-4">
                          {t('approvedAt', { datetime: formatBkk(r.approvedAt, locale) })}
                        </p>
                      )}
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${badgeCls}`}
                    >
                      {badgeText}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
