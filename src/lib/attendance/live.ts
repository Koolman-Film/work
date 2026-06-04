'use server';

/**
 * `getTodayAttendance()` — reused for both the initial Server-Component
 * render and the 30-second polling fallback in the live board client.
 *
 * Returns today's CheckIn rows (newest first) PLUS two roster figures the
 * KPI strip needs: the active-employee count (for "ยังไม่มา" = roster −
 * present) and today's OnLeave count (for the "ลา/หยุด" tile).
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

export type LiveBoardData = {
  rows: LiveAttendanceRow[];
  /** Active (non-archived) employees — the roster size for "ยังไม่มา". */
  activeCount: number;
  /** OnLeave attendance rows for today — the "ลา/หยุด" tile. */
  onLeaveCount: number;
};

function bangkokDateUtcMidnight(d: Date): Date {
  const ymd = d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  return new Date(`${ymd}T00:00:00.000Z`);
}

export async function getTodayAttendance(): Promise<LiveBoardData> {
  await requirePermission('attendance.live-board');

  const today = bangkokDateUtcMidnight(new Date());

  const [rows, activeCount, onLeaveCount] = await Promise.all([
    prisma.attendance.findMany({
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
    }),
    prisma.employee.count({ where: { archivedAt: null, status: { not: 'Archived' } } }),
    prisma.attendance.count({ where: { type: 'OnLeave', date: today, deletedAt: null } }),
  ]);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      employeeName: `${r.employee.firstName} ${r.employee.lastName}`,
      employeeNickname: r.employee.nickname,
      branchName: r.checkInBranch?.name ?? r.employee.branch.name,
      clockInAt: r.clockInAt ? r.clockInAt.toISOString() : null,
      clockOutAt: r.clockOutAt ? r.clockOutAt.toISOString() : null,
      checkInStatus: r.checkInStatus,
      isOverridden: r.isOverridden,
    })),
    activeCount,
    onLeaveCount,
  };
}
