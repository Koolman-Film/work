import 'server-only';

/**
 * Aggregation queries behind /admin/reports/* and /liff/summary.
 * Server-only. Dates are UTC-midnight @db.Date semantics; `from`/`to`
 * are inclusive YYYY-MM-DD strings from resolveReportPeriod.
 *
 * Soft-delete: the `prisma` client extension auto-filters deletedAt on
 * find* queries, but NOT on groupBy — so the explicit `deletedAt: null`
 * filters below are load-bearing there, and defence-in-depth elsewhere
 * (matching the convention in app/(liff)/liff/advance/page.tsx).
 *
 * Perf: advanceReport calls advanceBalanceFor per employee (3-6 queries each).
 * Bounded by headcount (tens, not thousands); revisit with a batched query
 * only if a report page measures slow.
 */
import { advanceBalanceFor } from '@/lib/advance/available';
import { prisma } from '@/lib/db/prisma';
import { remainingByTypeForEmployees } from '@/lib/leave/balance';

const utc = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

export type EmployeeFilter = { branchId?: string; departmentId?: string; q?: string };

function employeeWhere(f: EmployeeFilter) {
  return {
    archivedAt: null,
    ...(f.branchId ? { branchId: f.branchId } : {}),
    ...(f.departmentId ? { departmentId: f.departmentId } : {}),
    ...(f.q
      ? {
          OR: [
            { firstName: { contains: f.q, mode: 'insensitive' as const } },
            { lastName: { contains: f.q, mode: 'insensitive' as const } },
            { nickname: { contains: f.q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };
}

function displayName(e: { firstName: string; lastName: string; nickname: string | null }) {
  return e.nickname?.trim() ? e.nickname : `${e.firstName} ${e.lastName}`.trim();
}

// ── 1) Advances ───────────────────────────────────────────────────────────
export type AdvanceReportRow = {
  employeeId: string;
  name: string;
  approvedInPeriod: number;
  outstandingNow: number; // Approved & !isDeducted, all-time
  availableNow: number | null;
};

export async function advanceReport(
  period: { from: string; to: string },
  filter: EmployeeFilter,
): Promise<AdvanceReportRow[]> {
  const employees = await prisma.employee.findMany({
    where: employeeWhere(filter),
    orderBy: [{ firstName: 'asc' }],
    select: { id: true, firstName: true, lastName: true, nickname: true },
  });
  const ids = employees.map((e) => e.id);
  const [inPeriod, outstanding] = await Promise.all([
    prisma.cashAdvance.groupBy({
      by: ['employeeId'],
      where: {
        employeeId: { in: ids },
        deletedAt: null,
        status: 'Approved',
        // approvedAt is a real timestamp; this UTC-midnight window matches the owner-dashboard
        // convention (bangkokMonthStartUtc → T00:00:00.000Z). Approvals 00:00–07:00 Bangkok on a
        // boundary day bucket into the previous period — known 7h skew, accepted for an advisory report.
        approvedAt: { gte: utc(period.from), lt: new Date(utc(period.to).getTime() + 86_400_000) },
      },
      _sum: { amount: true },
    }),
    prisma.cashAdvance.groupBy({
      by: ['employeeId'],
      where: { employeeId: { in: ids }, deletedAt: null, status: 'Approved', isDeducted: false },
      _sum: { amount: true },
    }),
  ]);
  const inPeriodBy = new Map(inPeriod.map((g) => [g.employeeId, Number(g._sum.amount ?? 0)]));
  const outstandingBy = new Map(outstanding.map((g) => [g.employeeId, Number(g._sum.amount ?? 0)]));

  const balances = await Promise.all(employees.map((e) => advanceBalanceFor(e.id)));
  const rows: AdvanceReportRow[] = employees.map((e, i) => ({
    employeeId: e.id,
    name: displayName(e),
    approvedInPeriod: inPeriodBy.get(e.id) ?? 0,
    outstandingNow: outstandingBy.get(e.id) ?? 0,
    availableNow: balances[i]!.available,
  }));
  return rows;
}

// ── 2) Attendance (late / early-leave minutes) ────────────────────────────
export type AttendanceReportRow = {
  employeeId: string;
  name: string;
  lateCount: number;
  lateMinutes: number;
  earlyCount: number;
  earlyMinutes: number;
  absentDays: number;
  otMinutes: number;
};

export async function attendanceReport(
  period: { from: string; to: string },
  filter: EmployeeFilter,
): Promise<AttendanceReportRow[]> {
  const employees = await prisma.employee.findMany({
    where: employeeWhere(filter),
    orderBy: [{ firstName: 'asc' }],
    select: { id: true, firstName: true, lastName: true, nickname: true },
  });
  const ids = employees.map((e) => e.id);
  const dateRange = { gte: utc(period.from), lte: utc(period.to) };
  const [att, ot] = await Promise.all([
    prisma.attendance.groupBy({
      by: ['employeeId', 'type'],
      where: {
        employeeId: { in: ids },
        deletedAt: null,
        type: { in: ['Late', 'EarlyLeave', 'Absent'] },
        date: dateRange,
      },
      _count: { _all: true },
      _sum: { durationMinutes: true },
    }),
    prisma.overtimeEntry.groupBy({
      by: ['employeeId'],
      where: { employeeId: { in: ids }, deletedAt: null, status: 'Approved', date: dateRange },
      _sum: { minutes: true },
    }),
  ]);
  const otBy = new Map(ot.map((g) => [g.employeeId, g._sum.minutes ?? 0]));
  const attBy = new Map<string, AttendanceReportRow>();
  for (const e of employees) {
    attBy.set(e.id, {
      employeeId: e.id,
      name: displayName(e),
      lateCount: 0,
      lateMinutes: 0,
      earlyCount: 0,
      earlyMinutes: 0,
      absentDays: 0,
      otMinutes: otBy.get(e.id) ?? 0,
    });
  }
  for (const g of att) {
    const row = attBy.get(g.employeeId);
    if (!row) continue;
    if (g.type === 'Late') {
      row.lateCount = g._count._all;
      row.lateMinutes = g._sum.durationMinutes ?? 0;
    } else if (g.type === 'EarlyLeave') {
      row.earlyCount = g._count._all;
      row.earlyMinutes = g._sum.durationMinutes ?? 0;
    } else if (g.type === 'Absent') {
      row.absentDays = g._count._all;
    }
  }
  return [...attBy.values()];
}

// ── 3) Leave by type ─────────────────────────────────────────────────────
export type LeaveReportCell = {
  usedMinutes: number;
  overQuotaMinutes: number;
  deductAmount: number;
};
export type LeaveReportRow = {
  employeeId: string;
  name: string;
  /** leaveTypeId → cell (in-period usage of Approved requests) */
  byType: Record<string, LeaveReportCell>;
  /** leaveTypeId → annual remaining minutes (null = unlimited) */
  remainingByType: Record<string, number | null>;
};

/**
 * @param year Entitlement year for the remaining columns. Custom ranges
 *   spanning two calendar years still get one year's remaining (the year
 *   passed by the caller, typically the range's start year).
 */
export async function leaveReport(
  period: { from: string; to: string },
  filter: EmployeeFilter,
  year: number,
): Promise<{ types: Array<{ id: string; name: string }>; rows: LeaveReportRow[] }> {
  const [types, employees] = await Promise.all([
    prisma.leaveType.findMany({
      where: { archivedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.employee.findMany({
      where: employeeWhere(filter),
      orderBy: [{ firstName: 'asc' }],
      select: { id: true, firstName: true, lastName: true, nickname: true },
    }),
  ]);
  const ids = employees.map((e) => e.id);
  const grouped = await prisma.leaveRequest.groupBy({
    by: ['employeeId', 'leaveTypeId'],
    where: {
      employeeId: { in: ids },
      status: 'Approved',
      deletedAt: null,
      // Bucketed by startDate — month-spanning leave counts wholly in its start month,
      // matching usedMinutes' year convention (documented limitation).
      startDate: { gte: utc(period.from), lte: utc(period.to) },
    },
    _sum: { chargedMinutes: true, overQuotaMinutes: true, deductAmount: true },
  });
  const cellBy = new Map<string, LeaveReportCell>();
  for (const g of grouped) {
    cellBy.set(`${g.employeeId}:${g.leaveTypeId}`, {
      usedMinutes: g._sum.chargedMinutes ?? 0,
      overQuotaMinutes: g._sum.overQuotaMinutes ?? 0,
      deductAmount: Number(g._sum.deductAmount ?? 0),
    });
  }
  const remainingAll = await remainingByTypeForEmployees(ids, year);
  const rows: LeaveReportRow[] = employees.map((e) => {
    const byType: Record<string, LeaveReportCell> = {};
    for (const t of types) {
      byType[t.id] = cellBy.get(`${e.id}:${t.id}`) ?? {
        usedMinutes: 0,
        overQuotaMinutes: 0,
        deductAmount: 0,
      };
    }
    return {
      employeeId: e.id,
      name: displayName(e),
      byType,
      remainingByType: remainingAll[e.id] ?? {},
    };
  });
  return { rows, types };
}

// ── Drill-down detail (which date ranges, per employee) ───────────────────
// Backs the expandable report rows: the summary tables show per-employee
// totals; these return the individual leave/advance line items for the same
// period + filter, keyed by employeeId.

export type LeaveDetailItem = {
  id: string;
  leaveTypeName: string;
  /** @db.Date UTC-midnight; format at the view layer. */
  startDate: Date;
  endDate: Date;
  unit: string;
  chargedMinutes: number;
  overQuotaMinutes: number;
};

export async function leaveDetail(
  period: { from: string; to: string },
  filter: EmployeeFilter,
): Promise<Record<string, LeaveDetailItem[]>> {
  const employees = await prisma.employee.findMany({
    where: employeeWhere(filter),
    select: { id: true },
  });
  const ids = employees.map((e) => e.id);
  const reqs = await prisma.leaveRequest.findMany({
    where: {
      employeeId: { in: ids },
      status: 'Approved',
      deletedAt: null,
      // Bucketed by startDate — same convention as leaveReport's totals.
      startDate: { gte: utc(period.from), lte: utc(period.to) },
    },
    select: {
      id: true,
      employeeId: true,
      startDate: true,
      endDate: true,
      unit: true,
      chargedMinutes: true,
      overQuotaMinutes: true,
      leaveType: { select: { name: true } },
    },
    orderBy: { startDate: 'asc' },
  });
  const out: Record<string, LeaveDetailItem[]> = {};
  for (const r of reqs) {
    let list = out[r.employeeId];
    if (!list) {
      list = [];
      out[r.employeeId] = list;
    }
    list.push({
      id: r.id,
      leaveTypeName: r.leaveType.name,
      startDate: r.startDate,
      endDate: r.endDate,
      unit: r.unit,
      chargedMinutes: r.chargedMinutes ?? 0,
      overQuotaMinutes: r.overQuotaMinutes ?? 0,
    });
  }
  return out;
}

export type AdvanceDetailItem = {
  id: string;
  amount: number;
  /** When the advance was approved (the in-period anchor). */
  approvedAt: Date | null;
  isDeducted: boolean;
};

export async function advanceDetail(
  period: { from: string; to: string },
  filter: EmployeeFilter,
): Promise<Record<string, AdvanceDetailItem[]>> {
  const employees = await prisma.employee.findMany({
    where: employeeWhere(filter),
    select: { id: true },
  });
  const ids = employees.map((e) => e.id);
  const advances = await prisma.cashAdvance.findMany({
    where: {
      employeeId: { in: ids },
      deletedAt: null,
      status: 'Approved',
      // Same UTC-midnight window as advanceReport.approvedInPeriod.
      approvedAt: { gte: utc(period.from), lt: new Date(utc(period.to).getTime() + 86_400_000) },
    },
    select: { id: true, employeeId: true, amount: true, approvedAt: true, isDeducted: true },
    orderBy: { approvedAt: 'asc' },
  });
  const out: Record<string, AdvanceDetailItem[]> = {};
  for (const a of advances) {
    let list = out[a.employeeId];
    if (!list) {
      list = [];
      out[a.employeeId] = list;
    }
    list.push({
      id: a.id,
      amount: Number(a.amount),
      approvedAt: a.approvedAt,
      isDeducted: a.isDeducted,
    });
  }
  return out;
}
