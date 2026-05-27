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
import { LeaveNewForm } from './leave-new-form';

export default async function NewLeavePage() {
  await requireRole(['Employee']);

  const leaveTypes = await prisma.leaveType.findMany({
    where: { archivedAt: null },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, isPaid: true, annualQuota: true },
  });

  if (leaveTypes.length === 0) {
    // Defensive: if admin hasn't seeded any LeaveType yet, send the
    // employee back to the list with a hint rather than rendering a
    // form with an empty select.
    redirect('/liff/leave?error=no-leave-types');
  }

  // Today's date in YYYY-MM-DD (Bangkok) for the date `min` attribute.
  const todayYmd = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });

  return <LeaveNewForm leaveTypes={leaveTypes} minDate={todayYmd} />;
}
