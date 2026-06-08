/**
 * /liff/leave/new — submit a new leave request.
 *
 * Server Component fetches the LeaveType options + today's date for the
 * `min` attribute, then renders the Client form which owns the
 * date-range UX + working-day count preview.
 */

import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';
import { remainingByTypeForEmployee } from '@/lib/leave/balance';
import { getLeaveConfig } from '@/lib/leave/leave-config';
import { LeaveNewForm } from './leave-new-form';

export default async function NewLeavePage() {
  const { employee } = await requireRole(['Staff']);

  const [leaveTypes, leaveConfig] = await Promise.all([
    prisma.leaveType.findMany({
      where: { archivedAt: null },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        isPaid: true,
        annualQuota: true,
        allowFullDay: true,
        allowHalfDay: true,
        allowHourly: true,
      },
    }),
    getLeaveConfig(),
  ]);

  if (leaveTypes.length === 0) {
    // Defensive: if admin hasn't seeded any LeaveType yet, send the
    // employee back to the list with a hint rather than rendering a
    // form with an empty select.
    redirect('/liff/leave?error=no-leave-types');
  }

  // Today's date in YYYY-MM-DD (Bangkok) for the date `min` attribute.
  const todayYmd = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  const currentYear = Number(todayYmd.slice(0, 4));

  // Remaining balance per leave type for the current year (read-only; falls
  // back to the type's annualQuota default when no entitlement row exists).
  const remainingByType = employee
    ? await remainingByTypeForEmployee(employee.id, currentYear)
    : {};

  return (
    <LeaveNewForm
      leaveTypes={leaveTypes}
      minDate={todayYmd}
      leaveConfig={leaveConfig}
      remainingByType={remainingByType}
    />
  );
}
