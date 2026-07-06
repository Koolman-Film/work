/**
 * /liff/admin/dashboard — mobile at-a-glance summary for paired admins.
 *
 * The phone-sized counterpart of the web /admin dashboard: today's attendance
 * split + pending-work counts, each branch-scoped to the admin's permission.
 * Detailed drill-ins live in the inbox tab / web admin.
 *
 * Localized via the `liffAdmin` namespace — the shared LIFF language switcher
 * applies to these admin screens too.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { StatCard } from '@/components/ui/stat-card';
import { bangkokDateUtcMidnight } from '@/lib/attendance/date';
import {
  employeeBranchScope,
  permittedBranchesFromAssignments,
  viaEmployeeBranchScope,
} from '@/lib/auth/branch-scope';
import { canDo, getUserAssignments } from '@/lib/auth/check-permission';
import { requireLiffAdmin } from '@/lib/auth/require-liff-admin';
import { prisma } from '@/lib/db/prisma';

export const revalidate = 30;

export default async function LiffAdminDashboardPage() {
  const { user } = await requireLiffAdmin();
  // requireLiffAdmin gates `liff.admin`; the dashboard also needs `dashboard.read`.
  if (!(await canDo(user, 'dashboard.read'))) notFound();

  const assignments = await getUserAssignments(user.id);
  const leaveScope = viaEmployeeBranchScope(
    permittedBranchesFromAssignments(assignments, 'leave.read'),
  );
  const advScope = viaEmployeeBranchScope(
    permittedBranchesFromAssignments(assignments, 'advance.read'),
  );
  const attPermitted = permittedBranchesFromAssignments(assignments, 'attendance.read');
  const attScope = viaEmployeeBranchScope(attPermitted);
  const rosterScope = employeeBranchScope(attPermitted);

  const today = bangkokDateUtcMidnight(new Date());

  const [pendingLeave, pendingAdvance, checkedInRows, activeCount, onLeaveRows] = await Promise.all(
    [
      prisma.leaveRequest.count({ where: { status: 'Pending', ...leaveScope } }),
      prisma.cashAdvance.count({ where: { status: 'Pending', ...advScope } }),
      prisma.attendance.findMany({
        where: { type: 'CheckIn', date: today, ...attScope },
        distinct: ['employeeId'],
        select: { employeeId: true },
      }),
      prisma.employee.count({
        where: { archivedAt: null, status: { not: 'Archived' }, canCheckIn: true, ...rosterScope },
      }),
      // Distinct by employee: a date can hold two OnLeave rows (two halves).
      prisma.attendance.findMany({
        where: { type: 'OnLeave', date: today, deletedAt: null, ...attScope },
        distinct: ['employeeId'],
        select: { employeeId: true },
      }),
    ],
  );

  const checkedIn = checkedInRows.length;
  const onLeave = onLeaveRows.length;
  // Not-yet-checked-in = active roster minus those in today already (checked in
  // or on leave). Clamp at 0 — a checked-in employee could be off-roster.
  const notCheckedIn = Math.max(0, activeCount - checkedIn - onLeave);

  const t = await getTranslations('liffAdmin.dashboard');

  return (
    <main className="px-4 pt-4 pb-12">
      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-700">{t('attendanceToday')}</h2>
        <div className="grid grid-cols-3 gap-2">
          <StatCard label={t('checkedIn')} value={checkedIn} />
          <StatCard label={t('notCheckedIn')} value={notCheckedIn} />
          <StatCard label={t('onLeave')} value={onLeave} />
        </div>
        <p className="mt-2 text-[11px] text-gray-400">
          {t('totalCheckinEmployees', { count: activeCount })}
        </p>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">{t('pendingApprovals')}</h2>
        <div className="grid grid-cols-2 gap-2">
          <Link href="/liff/admin/inbox" className="block">
            <StatCard label={t('leaveRequests')} value={pendingLeave} hint={t('tapToView')} />
          </Link>
          <Link href="/liff/admin/inbox" className="block">
            <StatCard label={t('advanceRequests')} value={pendingAdvance} hint={t('tapToView')} />
          </Link>
        </div>
      </section>
    </main>
  );
}
