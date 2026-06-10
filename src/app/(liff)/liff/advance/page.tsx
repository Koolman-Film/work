/**
 * /liff/advance — list of own cash-advance requests.
 */

import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { advanceBalanceFor } from '@/lib/advance/available';
import { requireRole } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';
import type { Locale } from '@/lib/i18n/config';
import { formatDate, formatMoney, formatTime } from '@/lib/i18n/format';
import { BalanceCard } from './balance-card';

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

export default async function LiffAdvanceListPage() {
  const { employee } = await requireRole(['Staff']);
  if (!employee) throw new Error('requireRole did not return Employee');

  // Fetch in parallel: the full list (UI) and the balance (the shared
  // advanceBalanceFor helper — same numbers the admin approval guard sees,
  // including period earnings for Daily/Hourly employees).
  const [rows, balance, t, locale] = await Promise.all([
    prisma.cashAdvance.findMany({
      // `deletedAt: null` is explicit defence-in-depth: the soft-delete client
      // extension already filters top-level reads, but the balance/history of
      // someone's salary is load-bearing enough to state the intent here too.
      where: { employeeId: employee.id, deletedAt: null },
      orderBy: { requestedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        amount: true,
        status: true,
        requestedAt: true,
        approvedAt: true,
        isDeducted: true,
      },
    }),
    advanceBalanceFor(employee.id),
    getTranslations('advance'),
    getLocale(),
  ]);

  return (
    <main className="mx-auto max-w-md px-4 pt-8 pb-12">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{t('list.title')}</h1>
          <p className="mt-0.5 text-sm text-gray-500">{t('list.count', { n: rows.length })}</p>
        </div>
        <Link
          href="/liff/advance/new"
          className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700"
        >
          {t('list.newRequest')}
        </Link>
      </header>

      {/* Salary balance — the primary signal employees come here to see.
          Placed ABOVE the request list because "how much do I have left"
          is the question they're trying to answer, and the list is
          context. */}
      <div className="mb-6">
        <BalanceCard balance={balance} locale={locale as Locale} />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-12 text-center">
          <p className="text-sm text-gray-500">{t('list.empty')}</p>
          <Link
            href="/liff/advance/new"
            className="mt-3 inline-block text-sm font-medium text-primary-700 hover:text-primary-800"
          >
            {t('list.firstRequest')}
          </Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const cls = STATUS_CLS[r.status] ?? STATUS_CLS.Pending;
            return (
              <li key={r.id}>
                <Link
                  href={`/liff/advance/${r.id}`}
                  className="block rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-primary-200 hover:bg-primary-50/30"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-lg font-semibold tabular-nums text-gray-900">
                        {formatMoney(r.amount.toString(), locale as Locale)}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-500">
                        {t('list.submittedAt', {
                          datetime: formatDateTime(r.requestedAt, locale as Locale),
                        })}
                      </p>
                      {r.status === 'Approved' && r.isDeducted && (
                        <p className="mt-1 text-[10px] text-gray-400">{t('list.deducted')}</p>
                      )}
                    </div>
                    {cls && (
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}
                      >
                        {t(`status.${r.status}`)}
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <nav className="mt-8 flex justify-center text-xs">
        <Link href="/liff/check-in" className="text-gray-500 hover:text-gray-700">
          {t('list.backToCheckin')}
        </Link>
      </nav>
    </main>
  );
}
