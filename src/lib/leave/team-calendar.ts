/**
 * Team leave calendar — data loader for /liff/calendar.
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

export type TeamCalendarEntry = {
  leaveRequestId: string;
  employeeId: string;
  employeeName: string;
  /** Short label — nickname if present, else first name. Compact for grid cells. */
  shortLabel: string;
  leaveTypeName: string;
  status: 'Pending' | 'Approved';
  /** Inclusive YYYY-MM-DD range. */
  startDate: string;
  endDate: string;
  /** True when this is the viewer's own request. Used to highlight. */
  isMine: boolean;
};

export type TeamCalendarHoliday = {
  /** YYYY-MM-DD. */
  date: string;
  name: string;
};

export type TeamCalendarData = {
  entries: TeamCalendarEntry[];
  holidays: TeamCalendarHoliday[];
};

/** Format a UTC-midnight Date as YYYY-MM-DD. Inverse of parseInputDate. */
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

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

  // Step 2: load teammates + leaves + holidays in parallel.
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

// ─── Month math helpers ───────────────────────────────────────────────────

/** Parse `YYYY-MM` to UTC-midnight start/end of that month. Returns null on bad input. */
export function parseMonth(
  ym: string,
): { start: Date; end: Date; year: number; month0: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return null;
  const year = Number(m[1]);
  const month1 = Number(m[2]);
  if (month1 < 1 || month1 > 12) return null;
  const month0 = month1 - 1;
  const start = new Date(Date.UTC(year, month0, 1));
  // Day 0 of next month = last day of current month, at UTC midnight.
  const end = new Date(Date.UTC(year, month0 + 1, 0));
  return { start, end, year, month0 };
}

/** Current month in Bangkok time as YYYY-MM. */
export function currentMonthYM(): string {
  const ymdBkk = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  return ymdBkk.slice(0, 7);
}

/** Step a YYYY-MM by ±1 month, returning YYYY-MM. */
export function shiftMonth(ym: string, delta: 1 | -1): string {
  const m = parseMonth(ym);
  if (!m) return ym;
  const next = new Date(Date.UTC(m.year, m.month0 + delta, 1));
  const ny = next.getUTCFullYear();
  const nm = String(next.getUTCMonth() + 1).padStart(2, '0');
  return `${ny}-${nm}`;
}

/**
 * Build the 6×7 grid of dates for a calendar month, padded with leading
 * days from the previous month + trailing days from the next month so
 * the grid always renders as complete weeks. Week starts Sunday (Thai
 * convention — matches LINE itself and most domestic apps).
 *
 * Each cell carries the date + whether it's in the current month (for
 * styling out-of-month cells gray).
 */
export type GridDay = {
  /** YYYY-MM-DD. */
  date: string;
  /** 1..31 day number for display. */
  day: number;
  /** True if this date belongs to the visible month. False for pre/post padding. */
  inMonth: boolean;
};

export function buildMonthGrid(year: number, month0: number): GridDay[] {
  const firstOfMonth = new Date(Date.UTC(year, month0, 1));
  // getUTCDay: 0=Sun..6=Sat. Sunday-first grid means leading-pad = day-of-week.
  const leading = firstOfMonth.getUTCDay();
  const gridStart = new Date(Date.UTC(year, month0, 1 - leading));

  const out: GridDay[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart.getTime() + i * 86_400_000);
    out.push({
      date: ymd(d),
      day: d.getUTCDate(),
      inMonth: d.getUTCMonth() === month0,
    });
  }
  return out;
}

/** Group entries by YYYY-MM-DD date covering every day in their range. */
export function indexEntriesByDate(entries: TeamCalendarEntry[]): Map<string, TeamCalendarEntry[]> {
  const idx = new Map<string, TeamCalendarEntry[]>();
  for (const e of entries) {
    const start = new Date(`${e.startDate}T00:00:00.000Z`);
    const end = new Date(`${e.endDate}T00:00:00.000Z`);
    for (let d = start; d.getTime() <= end.getTime(); d = new Date(d.getTime() + 86_400_000)) {
      const key = ymd(d);
      const arr = idx.get(key);
      if (arr) arr.push(e);
      else idx.set(key, [e]);
    }
  }
  return idx;
}
