/** /liff/payslip — "สลิปเงินเดือน": the employee's own monthly payslip.
 *  Month nav via ?m=YYYY-MM. Only Published/Locked slips are visible —
 *  Drafts stay admin-side until the admin presses เผยแพร่. */

import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';
import type { Locale } from '@/lib/i18n/config';
import { formatMoney } from '@/lib/i18n/format';
import { adjustmentAppliesToMonth } from '@/lib/payroll/adjustments';
import { adjacentMonths } from '@/lib/reports/period';

/** Same Buddhist-year month label convention as /liff/summary. */
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

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export default async function LiffPayslipPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const { employee } = await requireRole(['Staff']);
  if (!employee) throw new Error('requireRole did not return Employee');
  const params = await searchParams;
  const todayYm = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 7);
  const month = params.m && MONTH_RE.test(params.m) ? params.m : todayYm;

  const [t, tPdf, rawLocale, slip, adjustments] = await Promise.all([
    getTranslations('payslip'),
    getTranslations('payslipPdf'),
    getLocale(),
    prisma.payroll.findFirst({
      where: { employeeId: employee.id, month, status: { in: ['Published', 'Locked'] } },
    }),
    prisma.payrollAdjustment.findMany({
      where: {
        employeeId: employee.id,
        startMonth: { lte: month },
        OR: [{ endMonth: null }, { endMonth: { gte: month } }],
        deletedAt: null,
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        kind: true,
        reason: true,
        amount: true,
        startMonth: true,
        endMonth: true,
      },
    }),
  ]);
  const locale = rawLocale as Locale;
  const { prev, next } = adjacentMonths(month);
  const monthLabel = buildMonthLabel(locale, month);
  const fmt = (v: { toNumber(): number } | number) =>
    formatMoney(typeof v === 'number' ? v : v.toNumber(), locale);

  // Per-reason detail lines are shown only when they still reconcile with
  // the frozen bucket totals on the Payroll row (adjustments may have been
  // edited after publish; the slip's stored numbers stay authoritative).
  const applicable = adjustments.filter((a) => adjustmentAppliesToMonth(a, month));
  const incomeLines = applicable.filter((a) => a.kind === 'Income');
  const deductLines = applicable.filter((a) => a.kind === 'Deduction');
  const sumOf = (xs: typeof applicable) => xs.reduce((acc, a) => acc + a.amount.toNumber(), 0);
  const showIncomeDetail =
    slip != null && incomeLines.length > 0 && sumOf(incomeLines) === slip.incomeOther.toNumber();
  const showDeductDetail =
    slip != null && deductLines.length > 0 && sumOf(deductLines) === slip.deductOther.toNumber();

  const cardCls = 'rounded-2xl border border-gray-200 bg-white p-5 shadow-sm';
  const row = (label: string, value: string, opts?: { strong?: boolean; muted?: boolean }) => (
    <div className={`flex justify-between ${opts?.strong ? 'font-medium' : ''}`}>
      <dt className={opts?.muted ? 'text-gray-400' : 'text-gray-500'}>{label}</dt>
      <dd className={opts?.muted ? 'text-gray-400' : 'text-gray-900'}>{value}</dd>
    </div>
  );

  return (
    <main className="mx-auto max-w-md space-y-4 px-4 pt-8 pb-12">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold text-gray-900">{t('title')}</h1>
        <div className="flex items-center gap-2">
          {slip && (
            <a
              href={`/liff/payslip/pdf?m=${month}`}
              className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              {tPdf('download')}
            </a>
          )}
          {month !== todayYm && (
            <Link
              href="/liff/payslip"
              className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              {t('thisMonth')}
            </Link>
          )}
        </div>
      </header>

      {/* Month navigator */}
      <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-3 py-2.5">
        <Link
          href={`/liff/payslip?m=${prev}`}
          aria-label={t('prevMonth')}
          className="grid size-8 place-items-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700"
        >
          ‹
        </Link>
        <p className="text-sm font-semibold text-gray-900">{monthLabel}</p>
        <Link
          href={`/liff/payslip?m=${next}`}
          aria-label={t('nextMonth')}
          className="grid size-8 place-items-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700"
        >
          ›
        </Link>
      </div>

      {!slip ? (
        <section className={`${cardCls} text-center`}>
          <p className="text-sm text-gray-500">{t('empty')}</p>
        </section>
      ) : (
        <>
          {/* Income */}
          <section className={cardCls}>
            <h2 className="text-sm font-semibold text-gray-900">{t('income.title')}</h2>
            <dl className="mt-3 space-y-1.5 text-sm">
              {row(t('income.base'), fmt(slip.incomeBase))}
              {showIncomeDetail
                ? incomeLines.map((a) => (
                    <div key={a.id} className="flex justify-between">
                      <dt className="text-gray-500">{a.reason}</dt>
                      <dd className="text-gray-900">{fmt(a.amount)}</dd>
                    </div>
                  ))
                : !slip.incomeOther.isZero() && row(t('income.other'), fmt(slip.incomeOther))}
              <div className="mt-2 flex justify-between border-t border-gray-100 pt-2 font-medium">
                <dt className="text-gray-700">{t('income.total')}</dt>
                <dd className="text-gray-900">
                  {fmt(slip.incomeBase.toNumber() + slip.incomeOther.toNumber())}
                </dd>
              </div>
            </dl>
          </section>

          {/* Deductions */}
          <section className={cardCls}>
            <h2 className="text-sm font-semibold text-gray-900">{t('deduct.title')}</h2>
            <dl className="mt-3 space-y-1.5 text-sm">
              {!slip.deductSso.isZero() && row(t('deduct.sso'), `-${fmt(slip.deductSso)}`)}
              {!slip.deductAdvance.isZero() &&
                row(t('deduct.advance'), `-${fmt(slip.deductAdvance)}`)}
              {!slip.deductAttendance.isZero() &&
                row(t('deduct.attendance'), `-${fmt(slip.deductAttendance)}`)}
              {!slip.deductLeave.isZero() && row(t('deduct.leave'), `-${fmt(slip.deductLeave)}`)}
              {!slip.deductDebt.isZero() && row(t('deduct.debt'), `-${fmt(slip.deductDebt)}`)}
              {showDeductDetail
                ? deductLines.map((a) => (
                    <div key={a.id} className="flex justify-between">
                      <dt className="text-gray-500">{a.reason}</dt>
                      <dd className="text-gray-900">-{fmt(a.amount)}</dd>
                    </div>
                  ))
                : !slip.deductOther.isZero() && row(t('deduct.other'), `-${fmt(slip.deductOther)}`)}
              {[
                slip.deductSso,
                slip.deductAdvance,
                slip.deductAttendance,
                slip.deductLeave,
                slip.deductDebt,
                slip.deductOther,
              ].every((d) => d.isZero()) && row(t('deduct.none'), '—', { muted: true })}
              <div className="mt-2 flex justify-between border-t border-gray-100 pt-2 font-medium">
                <dt className="text-gray-700">{t('deduct.total')}</dt>
                <dd className="text-gray-900">
                  -
                  {fmt(
                    slip.deductSso.toNumber() +
                      slip.deductAdvance.toNumber() +
                      slip.deductAttendance.toNumber() +
                      slip.deductLeave.toNumber() +
                      slip.deductDebt.toNumber() +
                      slip.deductOther.toNumber(),
                  )}
                </dd>
              </div>
            </dl>
          </section>

          {/* Net pay */}
          <section className={`${cardCls} bg-primary-50`}>
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-gray-900">{t('net')}</h2>
              <p className="text-2xl font-bold text-gray-900">{fmt(slip.netPay)}</p>
            </div>
          </section>
        </>
      )}

      <nav className="flex justify-center gap-4 text-xs">
        <Link href="/liff/summary" className="text-gray-500 hover:text-gray-700">
          {t('backToSummary')}
        </Link>
        <Link href="/liff/check-in" className="text-gray-500 hover:text-gray-700">
          {t('backToCheckin')}
        </Link>
      </nav>
    </main>
  );
}
