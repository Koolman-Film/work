'use server';

/**
 * `getTodayAttendance()` — reused for both the initial Server-Component
 * render and the 30-second polling fallback in the live board client.
 *
 * "Today" = current Bangkok calendar date. Returns the day's CheckIn rows
 * sorted by clockInAt desc, with employee + branch info denormalised so
 * the client can render without further fetches.
 *
 * Why pass through requireRole even on a read-only fetch:
 *   - Defense in depth. The server action runs with the caller's session;
 *     a future RLS rule on Attendance won't accidentally leak admin-only
 *     data to a non-admin if we always gate.
 *   - Centralises the audit story: every admin attendance query is logged
 *     to access logs (via requireRole's existing tracing hook, when wired).
 */

import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';

export type LiveAttendanceRow = {
  id: string;
  employeeName: string;
  employeeNickname: string | null;
  branchName: string;
  clockInAt: string | null; // ISO
  clockOutAt: string | null; // ISO
  checkInStatus: 'Confirmed' | 'Disputed' | 'Rejected' | null;
  isOverridden: boolean;
};

function bangkokDateUtcMidnight(d: Date): Date {
  const ymd = d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  return new Date(`${ymd}T00:00:00.000Z`);
}

export async function getTodayAttendance(): Promise<LiveAttendanceRow[]> {
  await requirePermission('attendance.live-board');

  const today = bangkokDateUtcMidnight(new Date());

  const rows = await prisma.attendance.findMany({
    where: { type: 'CheckIn', date: today },
    orderBy: { clockInAt: 'desc' },
    select: {
      id: true,
      clockInAt: true,
      clockOutAt: true,
      checkInStatus: true,
      isOverridden: true,
      checkInBranch: { select: { name: true } },
      employee: {
        select: {
          firstName: true,
          lastName: true,
          nickname: true,
          branch: { select: { name: true } },
        },
      },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    employeeName: `${r.employee.firstName} ${r.employee.lastName}`,
    employeeNickname: r.employee.nickname,
    // Prefer the system-matched branch (where they actually checked in);
    // fall back to their home branch if checkInBranch is null (e.g.
    // disputed/no-configured-branch case).
    branchName: r.checkInBranch?.name ?? r.employee.branch.name,
    clockInAt: r.clockInAt ? r.clockInAt.toISOString() : null,
    clockOutAt: r.clockOutAt ? r.clockOutAt.toISOString() : null,
    checkInStatus: r.checkInStatus,
    isOverridden: r.isOverridden,
  }));
}
