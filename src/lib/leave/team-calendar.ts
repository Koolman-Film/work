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
import { employeeBranchScope, type PermittedBranches } from '@/lib/auth/branch-scope';
import { prisma } from '@/lib/db/prisma';
import type { Locale } from '@/lib/i18n/config';
import { localizedLeaveTypeName } from './localized-name';
import {
  type TeamCalendarAdvance,
  type TeamCalendarBirthday,
  type TeamCalendarData,
  type TeamCalendarEntry,
  ymd,
} from './team-calendar-shape';

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
  /** Resolve LeaveType names for this locale; omit for the canonical (Thai)
   *  name — the admin views are intentionally untranslated. */
  locale?: Locale;
}): Promise<TeamCalendarData> {
  const { employees, monthStart, monthEnd, viewerEmployeeId, locale } = args;

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
      birthdays: [],
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
        leaveType: { select: { name: true, nameByLocale: true } },
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
        leaveTypeName: locale
          ? localizedLeaveTypeName(l.leaveType.name, l.leaveType.nameByLocale, locale)
          : l.leaveType.name,
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
    birthdays: [],
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
  /** Viewer locale for LeaveType display names (worker-facing). */
  locale?: Locale;
}): Promise<TeamCalendarData> {
  const { viewerEmployeeId, monthStart, monthEnd, locale } = args;

  const me = await prisma.employee.findUnique({
    where: { id: viewerEmployeeId },
    select: { branchId: true, assignedBranchIds: true },
  });
  if (!me) return { entries: [], holidays: [], advances: [], birthdays: [] };

  const myBranchIds = Array.from(new Set([me.branchId, ...me.assignedBranchIds]));

  const teammates = await prisma.employee.findMany({
    where: {
      archivedAt: null,
      status: { not: 'Archived' },
      OR: [{ branchId: { in: myBranchIds } }, { assignedBranchIds: { hasSome: myBranchIds } }],
    },
    select: { id: true, firstName: true, lastName: true, nickname: true },
  });

  return loadEntriesAndHolidays({
    employees: teammates,
    monthStart,
    monthEnd,
    viewerEmployeeId,
    locale,
  });
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
  permitted: PermittedBranches;
}): Promise<TeamCalendarData> {
  const { monthStart, monthEnd, branchId, permitted } = args;

  const baseWhere: Prisma.EmployeeWhereInput = {
    archivedAt: null,
    status: { not: 'Archived' },
  };
  if (branchId) {
    baseWhere.OR = [{ branchId }, { assignedBranchIds: { hasSome: [branchId] } }];
  }
  const scope = employeeBranchScope(permitted); // {} for 'all'
  const where: Prisma.EmployeeWhereInput = Object.keys(scope).length
    ? { AND: [baseWhere, scope] }
    : baseWhere;

  const employees = await prisma.employee.findMany({
    where,
    select: { id: true, firstName: true, lastName: true, nickname: true, dateOfBirth: true },
  });

  const base = await loadEntriesAndHolidays({
    employees,
    monthStart,
    monthEnd,
    viewerEmployeeId: null,
  });
  if (employees.length === 0) return base; // base.advances + base.birthdays already []

  // Cash advances are point-in-time: anchor each to its requestedAt day. Window
  // is [monthStart, firstOfNextMonth) so the whole last day of the month is
  // included. `prisma` (not prismaRaw) already excludes soft-deleted rows.
  const nextMonthStart = new Date(monthEnd.getTime() + 86_400_000);
  const advanceRows = await prisma.cashAdvance.findMany({
    where: {
      employeeId: { in: employees.map((e) => e.id) },
      status: { in: ['Pending', 'Approved'] },
      requestedAt: { gte: monthStart, lt: nextMonthStart },
    },
    select: { id: true, employeeId: true, amount: true, status: true, requestedAt: true },
    orderBy: { requestedAt: 'asc' },
  });

  const empMap = new Map(employees.map((e) => [e.id, e]));
  const thb = new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    maximumFractionDigits: 2,
  });

  const advances: TeamCalendarAdvance[] = advanceRows
    .map((a): TeamCalendarAdvance | null => {
      const emp = empMap.get(a.employeeId);
      if (!emp) return null; // shouldn't happen given the IN clause
      return {
        cashAdvanceId: a.id,
        employeeId: a.employeeId,
        employeeName: `${emp.firstName} ${emp.lastName}`.trim(),
        shortLabel: emp.nickname?.trim() || emp.firstName,
        amountLabel: thb.format(Number(a.amount)),
        status: a.status as 'Pending' | 'Approved',
        // Bangkok-calendar day so the anchor matches the grid's day cells.
        date: a.requestedAt.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }),
      };
    })
    .filter((x): x is TeamCalendarAdvance => x !== null);

  // Birthdays recur yearly: match each employee's birth month/day against the
  // displayed month and re-anchor to the displayed year so it lands on the grid.
  // monthStart is UTC-midnight first-of-month, so its UTC year/month ARE the
  // displayed month (no Bangkok skew to worry about for a whole-day marker).
  const displayYear = monthStart.getUTCFullYear();
  const displayMonth0 = monthStart.getUTCMonth();
  const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

  const birthdays: TeamCalendarBirthday[] = employees
    .filter((e) => e.dateOfBirth != null && e.dateOfBirth.getUTCMonth() === displayMonth0)
    .map((e): TeamCalendarBirthday => {
      const dob = e.dateOfBirth as Date;
      let day = dob.getUTCDate();
      // Feb 29 birthday in a non-leap display year → celebrate on Feb 28.
      if (displayMonth0 === 1 && day === 29 && !isLeapYear(displayYear)) day = 28;
      const date = `${displayYear}-${String(displayMonth0 + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      return {
        employeeId: e.id,
        employeeName: `${e.firstName} ${e.lastName}`.trim(),
        shortLabel: e.nickname?.trim() || e.firstName,
        date,
      };
    });

  return { ...base, advances, birthdays };
}
