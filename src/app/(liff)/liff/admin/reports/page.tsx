/**
 * /liff/admin/reports — mobile report SUMMARY for paired admins.
 *
 * Full per-employee report tables don't fit a phone, so this shows the
 * period totals (attendance + advances) as KPI tiles and links out to the
 * web admin for the detailed, filterable tables. Period + branch scope match
 * the web reports (payroll-cutoff window, `report.read` permitted branches)
 * so the numbers tie out.
 *
 * Localized via the `liffAdmin` namespace — the shared LIFF language switcher
 * applies to these admin screens too.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { StatCard } from '@/components/ui/stat-card';
import { getPermittedBranches } from '@/lib/auth/branch-scope';
import { canDo } from '@/lib/auth/check-permission';
import { requireLiffAdmin } from '@/lib/auth/require-liff-admin';
import { prisma } from '@/lib/db/prisma';
import { resolveReportPeriod } from '@/lib/reports/period';
import { advanceReport, attendanceReport } from '@/lib/reports/queries';

export const revalidate = 30;

const baht = (n: number) => `฿${Math.round(n).toLocaleString('th-TH')}`;

export default async function LiffAdminReportsPage() {
  const { user } = await requireLiffAdmin();
  // requireLiffAdmin gates `liff.admin`; reports also need `report.read`.
  if (!(await canDo(user, 'report.read'))) notFound();

  const permitted = await getPermittedBranches(user, 'report.read');
  const todayYmd = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  const cfg = await prisma.payrollConfig.findFirst({ select: { cutoffDay: true } });
  const period = resolveReportPeriod({}, todayYmd, cfg?.cutoffDay ?? undefined);

  const [attRows, advRows] = await Promise.all([
    attendanceReport(period, {}, permitted),
    advanceReport(period, {}, permitted),
  ]);

  const lateCount = attRows.reduce((s, r) => s + r.lateCount, 0);
  const absentDays = attRows.reduce((s, r) => s + r.absentDays, 0);
  const otHours = attRows.reduce((s, r) => s + r.otMinutes, 0) / 60;
  const approved = advRows.reduce((s, r) => s + r.approvedInPeriod, 0);
  const outstanding = advRows.reduce((s, r) => s + r.outstandingNow, 0);

  const t = await getTranslations('liffAdmin.reports');

  return (
    <main className="px-4 pt-4 pb-12">
      <p className="mb-3 text-xs text-gray-500">
        {t('period', { from: period.from, to: period.to })}
      </p>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-700">{t('attendance')}</h2>
        <div className="grid grid-cols-3 gap-2">
          <StatCard label={t('lateCount')} value={lateCount} />
          <StatCard label={t('absentDays')} value={absentDays} />
          <StatCard label={t('otHours')} value={otHours.toFixed(1)} />
        </div>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">{t('advances')}</h2>
        <div className="grid grid-cols-2 gap-2">
          <StatCard label={t('approvedThisPeriod')} value={baht(approved)} />
          <StatCard label={t('outstanding')} value={baht(outstanding)} />
        </div>
      </section>

      <Link
        href="/admin/reports/attendance"
        className="mt-6 block rounded-xl border border-line bg-surface p-4 text-center text-sm font-medium text-primary-700 shadow-sm"
      >
        {t('viewDetailed')}
      </Link>
    </main>
  );
}
