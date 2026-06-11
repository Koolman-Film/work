/** /liff/summary — "สรุปของฉัน": this month's lateness, annual leave balances
 *  (with over-quota deductions), advance balance. Month nav via ?m=YYYY-MM. */

import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { advanceBalanceFor } from '@/lib/advance/available';
import { requireRole } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';
import type { Locale } from '@/lib/i18n/config';
import { formatMoney } from '@/lib/i18n/format';
import { remainingByTypeForEmployee } from '@/lib/leave/balance';
import { getLeaveConfig } from '@/lib/leave/leave-config';
import { localizedLeaveTypeName } from '@/lib/leave/localized-name';
import { formatDurationParts, splitDaysHours } from '@/lib/leave/units';
import { adjacentMonths, resolveReportPeriod } from '@/lib/reports/period';

/** Month+year header label for the navigator — same convention as the
 *  /liff/calendar page: Thai shows the Buddhist year (CE+543, never Intl's
 *  buddhist calendar which appends "BE"), other locales use Intl natively. */
function buildMonthLabel(locale: Locale, ym: string): string {
  const year = Number(ym.slice(0, 4));
  const representative = new Date(`${ym}-01T00:00:00.000Z`);
  if (locale === 'th') {
    const monthName = new Intl.DateTimeFormat('th-TH-u-ca-gregory', {
      month: 'long',
      timeZone: 'UTC',
    }).format(representative);
    return `${monthName} ${year + 543}`;
  }
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(representative);
}

export default async function LiffSummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const { employee } = await requireRole(['Staff']);
  if (!employee) throw new Error('requireRole did not return Employee');
  const params = await searchParams;
  const todayYmd = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  const period = resolveReportPeriod({ m: params.m }, todayYmd);
  const month = period.month ?? todayYmd.slice(0, 7);
  const year = Number(month.slice(0, 4));
  const utc = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

  const [t, tUnits, rawLocale, cfg, att, types, remaining, usedAgg, balance] = await Promise.all([
    getTranslations('summary'),
    getTranslations('units'),
    getLocale(),
    getLeaveConfig(),
    prisma.attendance.groupBy({
      by: ['type'],
      where: {
        employeeId: employee.id,
        // NOTE: groupBy bypasses the soft-delete Prisma extension — the
        // explicit deletedAt: null filter is load-bearing.
        deletedAt: null,
        type: { in: ['Late', 'EarlyLeave', 'Absent'] },
        date: { gte: utc(period.from), lte: utc(period.to) },
      },
      _count: { _all: true },
      _sum: { durationMinutes: true },
    }),
    prisma.leaveType.findMany({
      where: { archivedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, nameByLocale: true },
    }),
    remainingByTypeForEmployee(employee.id, year),
    prisma.leaveRequest.groupBy({
      by: ['leaveTypeId'],
      where: {
        employeeId: employee.id,
        status: 'Approved',
        // load-bearing: soft-delete extension does not cover groupBy
        deletedAt: null,
        startDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
      },
      _sum: { chargedMinutes: true, deductAmount: true },
    }),
    advanceBalanceFor(employee.id),
  ]);
  const locale = rawLocale as Locale;

  const fmtDur = (minutes: number) =>
    formatDurationParts(splitDaysHours(minutes, cfg), {
      day: (n) => tUnits('day', { n }),
      hour: (n) => tUnits('hour', { n }),
      min: (n) => tUnits('min', { n }),
    });
  const attBy = new Map(att.map((g) => [g.type, g]));
  const usedBy = new Map(usedAgg.map((g) => [g.leaveTypeId, g]));
  const { prev, next } = adjacentMonths(month);
  const monthLabel = buildMonthLabel(locale, month);
  const displayYear = locale === 'th' ? year + 543 : year;

  const cardCls = 'rounded-2xl border border-gray-200 bg-white p-5 shadow-sm';
  return (
    <main className="mx-auto max-w-md space-y-4 px-4 pt-8 pb-12">
      <h1 className="text-2xl font-semibold text-gray-900">{t('title')}</h1>

      {/* Month navigator: prev / month-label / next */}
      <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-3 py-2.5">
        <Link
          href={`/liff/summary?m=${prev}`}
          aria-label={t('prevMonth')}
          className="grid size-8 place-items-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700"
        >
          ‹
        </Link>
        <p className="text-sm font-semibold text-gray-900">{monthLabel}</p>
        <Link
          href={`/liff/summary?m=${next}`}
          aria-label={t('nextMonth')}
          className="grid size-8 place-items-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700"
        >
          ›
        </Link>
      </div>

      {/* Attendance this month */}
      <section className={cardCls}>
        <h2 className="text-sm font-semibold text-gray-900">{t('attendance.title')}</h2>
        <dl className="mt-3 grid grid-cols-3 gap-3 text-center">
          {(
            [
              ['Late', t('attendance.late')],
              ['EarlyLeave', t('attendance.early')],
              ['Absent', t('attendance.absent')],
            ] as const
          ).map(([type, label]) => {
            const g = attBy.get(type);
            return (
              <div key={type} className="rounded-lg bg-gray-50 p-3">
                <dt className="text-xs text-gray-500">{label}</dt>
                <dd className="mt-1 text-lg font-semibold text-gray-900">{g?._count._all ?? 0}</dd>
                {type !== 'Absent' && (
                  <dd className="text-[11px] text-gray-500">
                    {t('attendance.minutes', { n: g?._sum.durationMinutes ?? 0 })}
                  </dd>
                )}
              </div>
            );
          })}
        </dl>
      </section>

      {/* Leave balances (annual) */}
      <section className={cardCls}>
        <h2 className="text-sm font-semibold text-gray-900">
          {t('leave.title', { year: displayYear })}
        </h2>
        <ul className="mt-3 divide-y divide-gray-100">
          {types.map((tp) => {
            const used = usedBy.get(tp.id);
            const rem = remaining[tp.id];
            const deduct = Number(used?._sum.deductAmount ?? 0);
            return (
              <li key={tp.id} className="flex items-baseline justify-between gap-2 py-2 text-sm">
                <span className="text-gray-700">
                  {localizedLeaveTypeName(tp.name, tp.nameByLocale, locale)}
                </span>
                <span className="text-right">
                  <span className="text-gray-900">{fmtDur(used?._sum.chargedMinutes ?? 0)}</span>
                  <span className="block text-[11px] text-gray-500">
                    {rem == null
                      ? t('leave.unlimited')
                      : t('leave.remaining', { d: fmtDur(Math.max(0, rem)) })}
                  </span>
                  {deduct > 0 && (
                    <span className="block text-[11px] text-amber-700">
                      {t('leave.deducted', { amount: formatMoney(deduct, locale) })}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Advance balance */}
      <section className={cardCls}>
        <h2 className="text-sm font-semibold text-gray-900">{t('advance.title')}</h2>
        <dl className="mt-3 space-y-1.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-gray-500">{t('advance.outstanding')}</dt>
            <dd className="text-gray-900">{formatMoney(balance.reserved, locale)}</dd>
          </div>
          {balance.kind === 'rate-based' && balance.earnings != null && (
            <div className="flex justify-between">
              <dt className="text-gray-500">{t('advance.earned')}</dt>
              <dd className="text-gray-900">{formatMoney(balance.earnings, locale)}</dd>
            </div>
          )}
          {balance.available != null && (
            <div className="flex justify-between font-medium">
              <dt className="text-gray-700">{t('advance.available')}</dt>
              <dd className="text-gray-900">{formatMoney(balance.available, locale)}</dd>
            </div>
          )}
        </dl>
      </section>

      <nav className="flex justify-center text-xs">
        <Link href="/liff/check-in" className="text-gray-500 hover:text-gray-700">
          {t('backToCheckin')}
        </Link>
      </nav>
    </main>
  );
}
