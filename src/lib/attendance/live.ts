'use server';

/**
 * `getTodayAttendance()` — reused for both the initial Server-Component render
 * and the 30-second polling fallback in the live board client.
 *
 * Returns today's CheckIn rows (newest first) PLUS the two employee lists the
 * KPI filters need (not-checked-in, on-leave) and the roster figures the KPI
 * strip shows. The not-checked-in list is a pure diff of the active
 * `canCheckIn` roster minus everyone "busy" today (checked-in ∪ on-leave). The
 * shapes + that pure diff live in ./live-shape (this is a Server Actions file,
 * which may only export async functions at runtime).
 */

import {
  employeeBranchScope,
  getPermittedBranches,
  viaEmployeeBranchScope,
} from '@/lib/auth/branch-scope';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { signAttendancePhotoUrls } from '@/lib/storage/signed-urls';
import { bangkokDateUtcMidnight, isClosedDay } from './date';
import {
  type LiveBoardData,
  type OnLeaveEmployee,
  type RosterEmployee,
  selectNotCheckedIn,
} from './live-shape';
import { isScheduledWorkday } from './schedule';

export type {
  LiveAttendanceRow,
  LiveBoardData,
  OnLeaveEmployee,
  RosterEmployee,
} from './live-shape';

export async function getTodayAttendance(): Promise<LiveBoardData> {
  const { user } = await requirePermission('attendance.live-board');
  const permitted = await getPermittedBranches(user, 'attendance.live-board');

  const today = bangkokDateUtcMidnight(new Date());

  const [checkInRows, rosterRows, onLeaveRows, holiday] = await Promise.all([
    prisma.attendance.findMany({
      where: { type: 'CheckIn', date: today, ...viaEmployeeBranchScope(permitted) },
      orderBy: { clockInAt: 'desc' },
      select: {
        id: true,
        employeeId: true,
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
            photoKey: true,
            branch: { select: { name: true } },
          },
        },
      },
    }),
    prisma.employee.findMany({
      where: {
        archivedAt: null,
        status: { not: 'Archived' },
        canCheckIn: true,
        ...employeeBranchScope(permitted),
      },
      orderBy: [{ branch: { name: 'asc' } }, { firstName: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        nickname: true,
        photoKey: true,
        branch: { select: { name: true } },
        workSchedule: { select: { days: { select: { dayOfWeek: true } } } },
      },
    }),
    prisma.attendance.findMany({
      where: {
        type: 'OnLeave',
        date: today,
        deletedAt: null,
        ...viaEmployeeBranchScope(permitted),
      },
      orderBy: [{ employee: { branch: { name: 'asc' } } }, { employee: { firstName: 'asc' } }],
      select: {
        id: true,
        employeeId: true,
        employee: {
          select: {
            firstName: true,
            lastName: true,
            nickname: true,
            photoKey: true,
            branch: { select: { name: true } },
          },
        },
        leaveRequest: {
          select: {
            startDate: true,
            endDate: true,
            leaveType: { select: { name: true } },
          },
        },
      },
    }),
    prisma.holiday.findFirst({ where: { date: today, archivedAt: null }, select: { id: true } }),
  ]);

  const closed = isClosedDay(today, holiday !== null);

  // One batched signing call for every photo on the board. Because this runs
  // on every fetch — including the client's 30s poll — URLs are re-signed
  // before their TTL can lapse, so the board never shows expired images.
  const photoUrls = await signAttendancePhotoUrls(
    [
      ...checkInRows.map((r) => r.employee.photoKey),
      ...rosterRows.map((e) => e.photoKey),
      ...onLeaveRows.map((r) => r.employee.photoKey),
    ].filter((k): k is string => Boolean(k)),
  );
  const photoUrl = (key: string | null) => (key ? (photoUrls.get(key) ?? null) : null);

  const todayDow = today.getUTCDay(); // 0=Sun..6=Sat (Bangkok weekday)
  const hasHoliday = holiday !== null;
  const roster: RosterEmployee[] = rosterRows.map((e) => ({
    id: e.id,
    employeeName: `${e.firstName} ${e.lastName}`,
    employeeNickname: e.nickname,
    photoUrl: photoUrl(e.photoKey),
    branchName: e.branch.name,
    scheduledToday: isScheduledWorkday(
      e.workSchedule?.days.map((d) => d.dayOfWeek),
      todayDow,
      hasHoliday,
    ),
  }));

  // "Busy" = anyone with a CheckIn (the displayed rows) or an OnLeave today.
  // Derived from the same rows we render, so the checked-in list and the
  // not-checked-in list can never double-count an employee.
  const busyEmployeeIds = new Set<string>([
    ...checkInRows.map((r) => r.employeeId),
    ...onLeaveRows.map((r) => r.employeeId),
  ]);

  // Dedup by employee: a date can now hold two OnLeave rows (a morning + an
  // afternoon half from separate requests). The board lists/counts each
  // employee once (first row wins).
  const onLeaveByEmp = new Map<string, OnLeaveEmployee>();
  for (const r of onLeaveRows) {
    if (onLeaveByEmp.has(r.employeeId)) continue;
    onLeaveByEmp.set(r.employeeId, {
      id: r.id,
      employeeName: `${r.employee.firstName} ${r.employee.lastName}`,
      employeeNickname: r.employee.nickname,
      photoUrl: photoUrl(r.employee.photoKey),
      branchName: r.employee.branch.name,
      leaveTypeName: r.leaveRequest?.leaveType.name ?? null,
      startDate: r.leaveRequest ? r.leaveRequest.startDate.toISOString() : null,
      endDate: r.leaveRequest ? r.leaveRequest.endDate.toISOString() : null,
    });
  }
  const onLeave: OnLeaveEmployee[] = [...onLeaveByEmp.values()];

  // Denominator for "เข้างานแล้ว X%" = everyone EXPECTED today: scheduled-today
  // employees plus anyone who actually checked in (the latter keeps the % from
  // exceeding 100% if someone works an unscheduled day).
  const expectedToday = new Set(roster.filter((r) => r.scheduledToday).map((r) => r.id));
  for (const r of checkInRows) expectedToday.add(r.employeeId);

  return {
    rows: checkInRows.map((r) => ({
      id: r.id,
      employeeName: `${r.employee.firstName} ${r.employee.lastName}`,
      employeeNickname: r.employee.nickname,
      photoUrl: photoUrl(r.employee.photoKey),
      // Group under the actual check-in branch (where they physically are);
      // carry home branch so the chip can flag a cross-branch check-in.
      branchName: r.checkInBranch?.name ?? r.employee.branch.name,
      homeBranchName: r.employee.branch.name,
      clockInAt: r.clockInAt ? r.clockInAt.toISOString() : null,
      clockOutAt: r.clockOutAt ? r.clockOutAt.toISOString() : null,
      checkInStatus: r.checkInStatus,
      isOverridden: r.isOverridden,
    })),
    notCheckedIn: selectNotCheckedIn(roster, busyEmployeeIds),
    onLeave,
    activeCount: expectedToday.size,
    onLeaveCount: onLeave.length,
    isClosedDay: closed,
  };
}
