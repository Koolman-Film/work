/**
 * /liff/admin/dashboard — mobile at-a-glance summary for paired admins.
 *
 * The phone-sized counterpart of the web /admin dashboard: today's attendance
 * split + pending-work counts, each branch-scoped to the admin's permission.
 * Detailed drill-ins live in the inbox tab / web admin.
 *
 * Thai-only literals — admin-facing, matches the untranslated admin panel.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
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

  return (
    <main className="px-4 pt-4 pb-12">
      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-700">การเข้างานวันนี้</h2>
        <div className="grid grid-cols-3 gap-2">
          <StatCard label="เข้างานแล้ว" value={checkedIn} />
          <StatCard label="ยังไม่เข้า" value={notCheckedIn} />
          <StatCard label="ลาวันนี้" value={onLeave} />
        </div>
        <p className="mt-2 text-[11px] text-gray-400">พนักงานที่ลงเวลาได้ทั้งหมด {activeCount} คน</p>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">งานรออนุมัติ</h2>
        <div className="grid grid-cols-2 gap-2">
          <Link href="/liff/admin/inbox" className="block">
            <StatCard label="คำขอลา" value={pendingLeave} hint="แตะเพื่อดู" />
          </Link>
          <Link href="/liff/admin/inbox" className="block">
            <StatCard label="คำขอเบิก" value={pendingAdvance} hint="แตะเพื่อดู" />
          </Link>
        </div>
      </section>
    </main>
  );
}
