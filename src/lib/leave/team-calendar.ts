import 'server-only';

/**
 * Leave-calendar data loaders.
 *
 * **Server-only.** The `import 'server-only'` marker makes any Client
 * Component import fail at compile time. Pure helpers (types, parseMonth,
 * buildMonthGrid, indexEntriesByDate, formatThaiMonthLabel) live in
 * `./team-calendar-shape.ts` and ARE safe to import from Client Components.
 *
 * Two public loaders, one shared core:
 *   - getTeamCalendarData  — employee view (/liff/calendar). Branch-scoped to
 *     the viewer: an employee is on my team if they share ANY branch with me
 *     (primary branchId OR assignedBranchIds overlap). Self is included.
 *   - getOrgCalendarData   — admin dashboard (/admin). All active employees by
 *     default, or a single branch when `branchId` is given.
 *
 * Both resolve an employee set, then delegate to `loadEntriesAndHolidays`,
 * which loads Pending+Approved leaves overlapping the month plus the month's
 * holidays. The leave query uses the classic overlap formula
 * `start ≤ monthEnd AND end ≥ monthStart` so a leave spanning Feb–Apr shows up
 * on the March view.
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { type TeamCalendarData, type TeamCalendarEntry, ymd } from './team-calendar-shape';

type EmployeeLite = {
  id: string;
  firstName: string;
  lastName: string;
  nickname: string | null;
};

/**
 * Shared core: given a resolved set of employees, load their leave entries
 * (Pending+Approved, overlapping the month) and the month's holidays.
 *
 * `viewerEmployeeId` marks each entry's `isMine`; pass `null` for admin/org
 * views where there is no "me" (every entry → isMine: false).
 *
 * Holidays load UNCONDITIONALLY — even when `employees` is empty — so an empty
 * branch still shows public holidays on the grid.
 */
async function loadEntriesAndHolidays(args: {
  employees: EmployeeLite[];
  monthStart: Date;
  monthEnd: Date;
  viewerEmployeeId: string | null;
}): Promise<TeamCalendarData> {
  const { employees, monthStart, monthEnd, viewerEmployeeId } = args;

  const holidaysPromise = prisma.holiday.findMany({
    where: { archivedAt: null, date: { gte: monthStart, lte: monthEnd } },
    select: { date: true, name: true },
    orderBy: { date: 'asc' },
  });

  if (employees.length === 0) {
    const holidays = await holidaysPromise;
    return {
      entries: [],
      holidays: holidays.map((h) => ({ date: ymd(h.date), name: h.name })),
      advances: [],
    };
  }

  const empMap = new Map(employees.map((e) => [e.id, e]));

  const [leaves, holidays] = await Promise.all([
    prisma.leaveRequest.findMany({
      where: {
        employeeId: { in: employees.map((e) => e.id) },
        status: { in: ['Pending', 'Approved'] },
        startDate: { lte: monthEnd },
        endDate: { gte: monthStart },
      },
      select: {
        id: true,
        employeeId: true,
        startDate: true,
        endDate: true,
        status: true,
        leaveType: { select: { name: true } },
      },
      // Chronological within a day so the detail panel reads top-to-bottom.
      orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
    }),
    holidaysPromise,
  ]);

  const entries: TeamCalendarEntry[] = leaves
    .map((l): TeamCalendarEntry | null => {
      const emp = empMap.get(l.employeeId);
      if (!emp) return null; // shouldn't happen given the IN clause
      const fullName = `${emp.firstName} ${emp.lastName}`.trim();
      const short = emp.nickname?.trim() || emp.firstName;
      return {
        leaveRequestId: l.id,
        employeeId: l.employeeId,
        employeeName: fullName,
        shortLabel: short,
        leaveTypeName: l.leaveType.name,
        status: l.status as 'Pending' | 'Approved',
        startDate: ymd(l.startDate),
        endDate: ymd(l.endDate),
        isMine: viewerEmployeeId !== null && l.employeeId === viewerEmployeeId,
      };
    })
    .filter((x): x is TeamCalendarEntry => x !== null);

  return {
    entries,
    holidays: holidays.map((h) => ({ date: ymd(h.date), name: h.name })),
    advances: [],
  };
}

/**
 * Employee view: leaves + holidays for everyone on `viewerEmployeeId`'s team
 * (shared-branch), for the month [monthStart, monthEnd].
 *
 * `monthStart` = first of month at UTC midnight; `monthEnd` = last day at UTC
 * midnight.
 */
export async function getTeamCalendarData(args: {
  viewerEmployeeId: string;
  monthStart: Date;
  monthEnd: Date;
}): Promise<TeamCalendarData> {
  const { viewerEmployeeId, monthStart, monthEnd } = args;

  const me = await prisma.employee.findUnique({
    where: { id: viewerEmployeeId },
    select: { branchId: true, assignedBranchIds: true },
  });
  if (!me) return { entries: [], holidays: [], advances: [] };

  const myBranchIds = Array.from(new Set([me.branchId, ...me.assignedBranchIds]));

  const teammates = await prisma.employee.findMany({
    where: {
      archivedAt: null,
      status: { not: 'Archived' },
      OR: [{ branchId: { in: myBranchIds } }, { assignedBranchIds: { hasSome: myBranchIds } }],
    },
    select: { id: true, firstName: true, lastName: true, nickname: true },
  });

  return loadEntriesAndHolidays({ employees: teammates, monthStart, monthEnd, viewerEmployeeId });
}

/**
 * Admin view: leaves + holidays across ALL active employees (branchId omitted)
 * or a single branch (branchId set → employees whose primary branch is it OR
 * who are assigned to it). No viewer, so every entry's `isMine` is false.
 */
export async function getOrgCalendarData(args: {
  monthStart: Date;
  monthEnd: Date;
  branchId?: string | null;
}): Promise<TeamCalendarData> {
  const { monthStart, monthEnd, branchId } = args;

  const where: Prisma.EmployeeWhereInput = {
    archivedAt: null,
    status: { not: 'Archived' },
  };
  if (branchId) {
    where.OR = [{ branchId }, { assignedBranchIds: { hasSome: [branchId] } }];
  }

  const employees = await prisma.employee.findMany({
    where,
    select: { id: true, firstName: true, lastName: true, nickname: true },
  });

  return loadEntriesAndHolidays({ employees, monthStart, monthEnd, viewerEmployeeId: null });
}
