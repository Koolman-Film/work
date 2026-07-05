import 'server-only';

import {
  employeeBranchScope,
  permittedBranchesFromAssignments,
  viaEmployeeBranchScope,
} from '@/lib/auth/branch-scope';
import type { AssignmentForCheck } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';

/**
 * The branch-scoped dashboard widget reads, extracted verbatim from
 * `admin/page.tsx` so they are unit-testable end-to-end. Each read is scoped by
 * its own domain permission (`leave.read` / `advance.read` / `attendance.read`)
 * off the actor's `assignments`; the scope fragment is `{}` for a global actor,
 * so their result is byte-identical to the pre-scope query.
 *
 * Self-user, holiday (org-config) and the calendar (its own `getOrgCalendarData`
 * unit test) stay in the page — they are not employee-linked branch reads.
 */
export async function loadDashboardStats(args: {
  assignments: ReadonlyArray<AssignmentForCheck>;
  /** Bangkok "today" at UTC midnight (a @db.Date value). */
  today: Date;
}) {
  const { assignments, today } = args;
  const leaveScope = viaEmployeeBranchScope(
    permittedBranchesFromAssignments(assignments, 'leave.read'),
  );
  const advScope = viaEmployeeBranchScope(
    permittedBranchesFromAssignments(assignments, 'advance.read'),
  );
  const attPermitted = permittedBranchesFromAssignments(assignments, 'attendance.read');
  const attScope = viaEmployeeBranchScope(attPermitted);
  const rosterScope = employeeBranchScope(attPermitted);

  const [
    pendingLeaveCount,
    pendingAdvanceCount,
    checkedInTodayRows,
    activeEmployees,
    onLeaveTodayRows,
    pendingLeaveRecent,
    pendingAdvanceRecent,
    onLeaveToday,
  ] = await Promise.all([
    prisma.leaveRequest.count({ where: { status: 'Pending', ...leaveScope } }),
    prisma.cashAdvance.count({ where: { status: 'Pending', ...advScope } }),
    prisma.attendance.findMany({
      where: { type: 'CheckIn', date: today, ...attScope },
      distinct: ['employeeId'],
      select: { employeeId: true },
    }),
    prisma.employee.findMany({
      where: {
        archivedAt: null,
        status: { not: 'Archived' },
        canCheckIn: true,
        ...rosterScope,
      },
      select: {
        id: true,
        workSchedule: { select: { days: { select: { dayOfWeek: true } } } },
      },
    }),
    // Distinct by employee: a date can hold two OnLeave rows (two halves), so
    // count people on leave, not rows.
    prisma.attendance.findMany({
      where: { type: 'OnLeave', date: today, deletedAt: null, ...attScope },
      distinct: ['employeeId'],
      select: { employeeId: true },
    }),
    prisma.leaveRequest.findMany({
      where: { status: 'Pending', ...leaveScope },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        createdAt: true,
        startDate: true,
        endDate: true,
        leaveType: { select: { name: true } },
        employee: { select: { firstName: true, lastName: true, nickname: true } },
      },
    }),
    prisma.cashAdvance.findMany({
      where: { status: 'Pending', ...advScope },
      orderBy: { requestedAt: 'desc' },
      take: 5,
      select: {
        id: true,
        amount: true,
        requestedAt: true,
        employee: { select: { firstName: true, lastName: true, nickname: true } },
      },
    }),
    prisma.attendance.findMany({
      where: { type: 'OnLeave', date: today, deletedAt: null, ...attScope },
      distinct: ['employeeId'],
      orderBy: { employee: { firstName: 'asc' } },
      select: {
        id: true,
        employee: { select: { firstName: true, lastName: true, nickname: true } },
        leaveRequest: {
          select: {
            startDate: true,
            endDate: true,
            leaveType: { select: { name: true } },
          },
        },
      },
    }),
  ]);

  return {
    pendingLeaveCount,
    pendingAdvanceCount,
    checkedInTodayRows,
    activeEmployees,
    onLeaveTodayRows,
    pendingLeaveRecent,
    pendingAdvanceRecent,
    onLeaveToday,
  };
}
