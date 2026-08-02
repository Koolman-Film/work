/** /liff/payslip — "สลิปเงินเดือน": the employee's own monthly payslip.
 *  Month nav via ?m=YYYY-MM. Only Published/Locked slips are visible —
 *  Drafts stay admin-side until the admin presses เผยแพร่. */

import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { requireEmployee } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';
import type { Locale } from '@/lib/i18n/config';
import { formatMoney } from '@/lib/i18n/format';
import { localizedLeaveTypeName } from '@/lib/leave/localized-name';
import { getPayslipDocument } from '@/lib/payslip/document';
import type { PayslipLine } from '@/lib/payslip/types';
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
  const { employee } = await requireEmployee();
  const params = await searchParams;
  const cardCls = 'rounded-2xl border border-line bg-surface p-5 shadow-sm';

  // Bare /liff/payslip (no valid ?m=) lists every Published/Locked month so
  // employees can browse history instead of only seeing the current month.
  if (!params.m || !MONTH_RE.test(params.m)) {
    const [t, tPdf, rawLocale, months] = await Promise.all([
      getTranslations('payslip'),
      getTranslations('payslipPdf'),
      getLocale(),
      prisma.payroll.findMany({
        where: { employeeId: employee.id, status: { in: ['Published', 'Locked'] } },
        orderBy: { month: 'desc' },
        select: { month: true, netPay: true },
      }),
    ]);
    const locale = rawLocale as Locale;

    return (
      <main className="mx-auto max-w-md space-y-4 px-4 pt-8 pb-12">
        <header className="flex items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold text-gray-900">{t('title')}</h1>
        </header>

        {months.length === 0 ? (
          <section className={`${cardCls} text-center`}>
            <p className="text-sm text-gray-500">{t('empty')}</p>
          </section>
        ) : (
          months.map((m) => (
            <div key={m.month} className={`${cardCls} flex items-center justify-between gap-3`}>
              <Link href={`/liff/payslip?m=${m.month}`} className="flex-1">
                <p className="text-sm font-medium text-gray-900">
                  {buildMonthLabel(locale, m.month)}
                </p>
                <p className="mt-0.5 text-sm text-gray-500">
                  {formatMoney(m.netPay.toNumber(), locale)}
                </p>
              </Link>
              <a
                href={`/liff/payslip/pdf?m=${m.month}`}
                className="rounded-md border border-line bg-surface px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-surface-muted"
              >
                {tPdf('download')}
              </a>
            </div>
          ))
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

  const todayYm = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 7);
  const month = params.m && MONTH_RE.test(params.m) ? params.m : todayYm;

  // Built through the SAME assembler the downloadable PDF uses
  // (getPayslipDocument → assemblePayslipDocument), so the on-screen slip and
  // the PDF can never disagree about which lines a month has — including the
  // settled-with-leave lines, which are keyed independently of
  // deductAttendance and must show up here exactly as they do in the PDF.
  const [t, tPdf, rawLocale, doc] = await Promise.all([
    getTranslations('payslip'),
    getTranslations('payslipPdf'),
    getLocale(),
    getPayslipDocument(employee.id, month),
  ]);
  const locale = rawLocale as Locale;
  const { prev, next } = adjacentMonths(month);
  const monthLabel = buildMonthLabel(locale, month);
  const fmt = (v: number) => formatMoney(v, locale);

  const row = (label: string, value: string, opts?: { strong?: boolean; muted?: boolean }) => (
    <div className={`flex justify-between ${opts?.strong ? 'font-medium' : ''}`}>
      <dt className={opts?.muted ? 'text-gray-400' : 'text-gray-500'}>{label}</dt>
      <dd className={opts?.muted ? 'text-gray-400' : 'text-gray-900'}>{value}</dd>
    </div>
  );

  // Resolves a line's label the same way the PDF's `render-html.ts` does: a
  // literal `label` (adjustment reason) renders as-is; a `labelKey` resolves
  // through i18n in the reader's own locale, with the settled-with-leave
  // lines' `{leaveType}` placeholder filled from the raw name/nameByLocale
  // data via `localizedLeaveTypeName` (this workforce reads Burmese, Lao and
  // Khmer, not just Thai).
  const lineLabel = (l: PayslipLine): string => {
    if (l.label) return l.label;
    const vars = l.leaveType
      ? {
          ...l.vars,
          leaveType: localizedLeaveTypeName(l.leaveType.name, l.leaveType.nameByLocale, locale),
        }
      : l.vars;
    return t(l.labelKey! as Parameters<typeof t>[0], vars);
  };

  return (
    <main className="mx-auto max-w-md space-y-4 px-4 pt-8 pb-12">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold text-gray-900">{t('title')}</h1>
        <div className="flex items-center gap-2">
          {doc && (
            <a
              href={`/liff/payslip/pdf?m=${month}`}
              className="rounded-md border border-line bg-surface px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-surface-muted"
            >
              {tPdf('download')}
            </a>
          )}
          {month !== todayYm && (
            <Link
              href="/liff/payslip"
              className="rounded-md border border-line bg-surface px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-surface-muted"
            >
              {t('thisMonth')}
            </Link>
          )}
        </div>
      </header>

      {/* Month navigator */}
      <div className="flex items-center justify-between rounded-xl border border-line bg-surface px-3 py-2.5">
        <Link
          href={`/liff/payslip?m=${prev}`}
          aria-label={t('prevMonth')}
          className="grid size-8 place-items-center rounded-md text-gray-500 hover:bg-surface-sunken hover:text-gray-700"
        >
          ‹
        </Link>
        <p className="text-sm font-semibold text-gray-900">{monthLabel}</p>
        <Link
          href={`/liff/payslip?m=${next}`}
          aria-label={t('nextMonth')}
          className="grid size-8 place-items-center rounded-md text-gray-500 hover:bg-surface-sunken hover:text-gray-700"
        >
          ›
        </Link>
      </div>

      {!doc ? (
        <section className={`${cardCls} text-center`}>
          <p className="text-sm text-gray-500">{t('empty')}</p>
        </section>
      ) : (
        <>
          {/* Income */}
          <section className={cardCls}>
            <h2 className="text-sm font-semibold text-gray-900">{t('income.title')}</h2>
            <dl className="mt-3 space-y-1.5 text-sm">
              {doc.income.lines.map((l) => (
                <div key={l.key} className="flex justify-between">
                  <dt className="text-gray-500">{lineLabel(l)}</dt>
                  <dd className="text-gray-900">{fmt(l.amount)}</dd>
                </div>
              ))}
              <div className="mt-2 flex justify-between border-t border-line-soft pt-2 font-medium">
                <dt className="text-gray-700">{t('income.total')}</dt>
                <dd className="text-gray-900">{fmt(doc.income.total)}</dd>
              </div>
            </dl>
          </section>

          {/* Deductions */}
          <section className={cardCls}>
            <h2 className="text-sm font-semibold text-gray-900">{t('deduct.title')}</h2>
            <dl className="mt-3 space-y-1.5 text-sm">
              {doc.deduct.lines.map((l) => (
                <div key={l.key} className="flex justify-between">
                  <dt className="text-gray-500">{lineLabel(l)}</dt>
                  <dd className="text-gray-900">-{fmt(l.amount)}</dd>
                </div>
              ))}
              {/* Only when there is truly nothing to show — including no
                  settled-with-leave lines, which must always render even in
                  a month whose deductAttendance bucket nets to zero. Gating
                  on the assembled line list (not the raw buckets) is what
                  keeps this fallback from contradicting a settled line. */}
              {doc.deduct.lines.length === 0 && row(t('deduct.none'), '—', { muted: true })}
              <div className="mt-2 flex justify-between border-t border-line-soft pt-2 font-medium">
                <dt className="text-gray-700">{t('deduct.total')}</dt>
                <dd className="text-gray-900">-{fmt(doc.deduct.total)}</dd>
              </div>
            </dl>
          </section>

          {/* Net pay */}
          <section className={`${cardCls} bg-primary-50`}>
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-gray-900">{t('net')}</h2>
              <p className="text-2xl font-bold text-gray-900">{fmt(doc.net)}</p>
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
