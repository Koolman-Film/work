/**
 * /liff/leave — list of own leave requests.
 *
 * Phase-1 simplicity: single list, newest first, status badges. The
 * "filter chips" (All / Pending / Approved / etc) the v1 spec described
 * land in W4-polish if we find we need them — for now the list is short
 * enough that an employee can scan it.
 */

import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';
import type { Locale } from '@/lib/i18n/config';
import { localizedLeaveTypeName } from '@/lib/leave/localized-name';

const STATUS_CLS: Record<string, string> = {
  Pending: 'bg-amber-100 text-amber-800',
  Approved: 'bg-green-100 text-green-800',
  Rejected: 'bg-red-100 text-red-800',
  Cancelled: 'bg-gray-100 text-gray-700',
};

function formatRange(start: Date, end: Date, locale: Locale): string {
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: 'UTC', // we stored as UTC midnight; show that calendar day
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  };
  if (
    start.getUTCFullYear() === end.getUTCFullYear() &&
    start.getUTCMonth() === end.getUTCMonth() &&
    start.getUTCDate() === end.getUTCDate()
  ) {
    // Single-day: format with Intl directly (formatDate uses Bangkok TZ; here we need UTC)
    return new Intl.DateTimeFormat(locale === 'th' ? 'th-TH-u-ca-gregory' : locale, opts).format(
      start,
    );
  }
  const startStr = new Intl.DateTimeFormat(locale === 'th' ? 'th-TH-u-ca-gregory' : locale, {
    ...opts,
    year: undefined,
  }).format(start);
  const endStr = new Intl.DateTimeFormat(
    locale === 'th' ? 'th-TH-u-ca-gregory' : locale,
    opts,
  ).format(end);
  return `${startStr} – ${endStr}`;
}

export default async function LiffLeaveListPage() {
  const { employee } = await requireRole(['Staff']);
  if (!employee) throw new Error('requireRole did not return Employee');

  const [rows, t, locale] = await Promise.all([
    prisma.leaveRequest.findMany({
      where: { employeeId: employee.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        leaveType: { select: { name: true, nameByLocale: true } },
        startDate: true,
        endDate: true,
        reason: true,
        status: true,
        createdAt: true,
      },
    }),
    getTranslations('leave'),
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
          href="/liff/leave/new"
          className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700"
        >
          {t('list.newRequest')}
        </Link>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-12 text-center">
          <p className="text-sm text-gray-500">{t('list.empty')}</p>
          <Link
            href="/liff/leave/new"
            className="mt-3 inline-block text-sm font-medium text-primary-700 hover:text-primary-800"
          >
            {t('list.firstRequest')}
          </Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const cls = STATUS_CLS[r.status] ?? STATUS_CLS.Pending;
            const statusLabel = t(`status.${r.status}` as Parameters<typeof t>[0]);
            return (
              <li key={r.id}>
                <Link
                  href={`/liff/leave/${r.id}`}
                  className="block rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-primary-200 hover:bg-primary-50/30"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">
                        {localizedLeaveTypeName(
                          r.leaveType.name,
                          r.leaveType.nameByLocale,
                          locale as Locale,
                        )}
                      </p>
                      <p className="mt-1 text-xs text-gray-600">
                        {formatRange(r.startDate, r.endDate, locale as Locale)}
                      </p>
                      <p className="mt-1 line-clamp-2 text-xs text-gray-500">{r.reason}</p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}
                    >
                      {statusLabel}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <nav className="mt-8 flex justify-center gap-4 text-xs">
        <Link href="/liff/check-in" className="text-gray-500 hover:text-gray-700">
          {t('list.backToCheckin')}
        </Link>
        <Link href="/liff/calendar" className="text-gray-500 hover:text-gray-700">
          {t('list.teamCalendar')}
        </Link>
      </nav>
    </main>
  );
}
