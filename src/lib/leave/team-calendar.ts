import 'server-only';

/**
 * Team leave calendar — data loader for /liff/calendar.
 *
 * **Server-only.** The `import 'server-only'` marker at the top makes
 * any Client Component import attempt fail loudly at compile time —
 * preventing the Prisma-in-browser-bundle leak we caught during the
 * first prod build (W5-deploy).
 *
 * Pure helpers (types, parseMonth, buildMonthGrid, indexEntriesByDate)
 * live in `./team-calendar-shape.ts` and ARE safe to import from Client
 * Components.
 *
 * "Team" definition: an employee is on my team if they share ANY branch
 * with me — meaning either their `branchId` is in my branches, OR their
 * `assignedBranchIds` overlaps my branches. The relation is symmetric:
 * if Pim is assigned to my branch, I see her leave and she sees mine.
 * (Per requirement.docx §1 "ดูปฏิทินคนลาในทีม".)
 *
 * Performance notes:
 *   - One findMany for teammates, one for leaves overlapping the month,
 *     one for holidays. Three round-trips, all on indexed columns.
 *   - The leave query uses the classic overlap formula
 *     `start ≤ monthEnd AND end ≥ monthStart` so a leave spanning Feb–Apr
 *     correctly shows up on the March view.
 *   - Self is intentionally INCLUDED in teammates — the employee should
 *     see their own approved leave on the calendar (it's a planning view,
 *     not "other people's leave").
 */

import { prisma } from '@/lib/db/prisma';
import { type TeamCalendarData, type TeamCalendarEntry, ymd } from './team-calendar-shape';

/**
 * Load all leave entries and holidays that intersect [monthStart, monthEnd]
 * for everyone on `viewerEmployeeId`'s team.
 *
 * `monthStart` should be the FIRST of the month at UTC midnight.
 * `monthEnd` should be the LAST day of the month at UTC midnight.
 */
export async function getTeamCalendarData(args: {
  viewerEmployeeId: string;
  monthStart: Date;
  monthEnd: Date;
}): Promise<TeamCalendarData> {
  const { viewerEmployeeId, monthStart, monthEnd } = args;

  // Step 1: figure out my branches.
  const me = await prisma.employee.findUnique({
    where: { id: viewerEmployeeId },
    select: { branchId: true, assignedBranchIds: true },
  });
  if (!me) return { entries: [], holidays: [] };

  const myBranchIds = Array.from(new Set([me.branchId, ...me.assignedBranchIds]));

  // Step 2: load teammates + leaves + holidays.
  // We split the teammate lookup from the leave lookup so the leave
  // query can use `employeeId IN (...)` — Prisma can't express the
  // branch-intersection condition transitively through LeaveRequest.
  const teammates = await prisma.employee.findMany({
    where: {
      archivedAt: null,
      status: { not: 'Archived' },
      OR: [{ branchId: { in: myBranchIds } }, { assignedBranchIds: { hasSome: myBranchIds } }],
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      nickname: true,
    },
  });

  if (teammates.length === 0) return { entries: [], holidays: [] };

  const [leaves, holidays] = await Promise.all([
    prisma.leaveRequest.findMany({
      where: {
        employeeId: { in: teammates.map((t) => t.id) },
        status: { in: ['Pending', 'Approved'] },
        // Range-overlap: existing.start ≤ ours.end AND existing.end ≥ ours.start.
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
      // Sort by start date so the detail panel shows leaves in chronological
      // order within a day — earlier-starting leaves appear first.
      orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.holiday.findMany({
      where: {
        archivedAt: null,
        date: { gte: monthStart, lte: monthEnd },
      },
      select: { date: true, name: true },
      orderBy: { date: 'asc' },
    }),
  ]);

  // Build a quick lookup from employeeId → display info.
  const empMap = new Map(teammates.map((t) => [t.id, t]));

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
        isMine: l.employeeId === viewerEmployeeId,
      };
    })
    .filter((x): x is TeamCalendarEntry => x !== null);

  return {
    entries,
    holidays: holidays.map((h) => ({ date: ymd(h.date), name: h.name })),
  };
}
