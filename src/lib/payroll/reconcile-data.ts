// src/lib/payroll/reconcile-data.ts
import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { flagRow, type PayrollBreakdown, type ReconcileFlag } from './reconcile';

export type ReconRow = {
  employeeId: string;
  name: string;
  branchName: string;
  current: PayrollBreakdown | null;
  baseline: (PayrollBreakdown & { month: string }) | null;
  netDeltaAbs: number;
  adjustments: { kind: 'Income' | 'Deduction'; reason: string; amount: number }[];
  flags: ReconcileFlag[];
};
export type ReconciliationView = {
  month: string;
  status: 'Draft' | 'Published' | 'Locked' | 'None';
  totals: { gross: number; deductions: number; net: number; headcount: number };
  byBranch: { branchId: string; branchName: string; net: number; headcount: number }[];
  rows: ReconRow[];
};

const PAY_SELECT = {
  incomeBase: true,
  incomeAllowance: true,
  incomeOther: true,
  deductSso: true,
  deductAdvance: true,
  deductAttendance: true,
  deductLeave: true,
  deductDebt: true,
  deductOther: true,
  netPay: true,
} as const;

type PaySelectResult = Prisma.PayrollGetPayload<{ select: typeof PAY_SELECT }>;

// Prisma Decimal fields → plain numbers.
function toBreakdown(p: PaySelectResult): PayrollBreakdown {
  return {
    incomeBase: p.incomeBase.toNumber(),
    incomeAllowance: p.incomeAllowance.toNumber(),
    incomeOther: p.incomeOther.toNumber(),
    deductSso: p.deductSso.toNumber(),
    deductAdvance: p.deductAdvance.toNumber(),
    deductAttendance: p.deductAttendance.toNumber(),
    deductLeave: p.deductLeave.toNumber(),
    deductDebt: p.deductDebt.toNumber(),
    deductOther: p.deductOther.toNumber(),
    netPay: p.netPay.toNumber(),
  };
}

export async function loadReconciliation(month: string): Promise<ReconciliationView> {
  const [current, roster, latestFrozenMonths, adjustments] = await Promise.all([
    prisma.payroll.findMany({
      where: { month },
      select: {
        employeeId: true,
        status: true,
        ...PAY_SELECT,
        employee: {
          select: {
            firstName: true,
            lastName: true,
            branchId: true,
            branch: { select: { name: true } },
          },
        },
      },
    }),
    prisma.employee.findMany({
      where: { archivedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        branchId: true,
        branch: { select: { name: true } },
      },
    }),
    // Baseline = each employee's most-recent FROZEN month before `month`.
    // groupBy → one (employeeId, max month) row per employee, bounded by
    // headcount regardless of how many years of history exist (vs. scanning
    // every frozen row). `@@unique([employeeId, month])` guarantees the row at
    // that (employeeId, month) IS the frozen one, so the follow-up fetch below
    // is exact. `_max(month)` skips gaps, and the status filter keeps a newer
    // Draft month from ever winning.
    prisma.payroll.groupBy({
      by: ['employeeId'],
      where: { month: { lt: month }, status: { in: ['Published', 'Locked'] } },
      _max: { month: true },
    }),
    prisma.payrollAdjustment.findMany({
      where: {
        deletedAt: null,
        startMonth: { lte: month },
        OR: [{ endMonth: null }, { endMonth: { gte: month } }],
      },
      select: { employeeId: true, kind: true, reason: true, amount: true },
    }),
  ]);

  // Fetch the breakdown for exactly the (employeeId, latest-frozen-month) pairs.
  const baselinePairs = latestFrozenMonths
    .filter((g): g is typeof g & { _max: { month: string } } => g._max.month !== null)
    .map((g) => ({ employeeId: g.employeeId, month: g._max.month }));
  const priorFrozen = baselinePairs.length
    ? await prisma.payroll.findMany({
        where: { status: { in: ['Published', 'Locked'] }, OR: baselinePairs },
        select: { employeeId: true, month: true, ...PAY_SELECT },
      })
    : [];

  const baselineByEmp = new Map<string, PayrollBreakdown & { month: string }>();
  for (const p of priorFrozen) {
    baselineByEmp.set(p.employeeId, { ...toBreakdown(p), month: p.month });
  }

  const adjByEmp = new Map<string, ReconRow['adjustments']>();
  for (const a of adjustments) {
    const list = adjByEmp.get(a.employeeId) ?? [];
    list.push({
      kind: a.kind as 'Income' | 'Deduction',
      reason: a.reason,
      amount: a.amount.toNumber(),
    });
    adjByEmp.set(a.employeeId, list);
  }

  const currentByEmp = new Map(current.map((p) => [p.employeeId, p]));

  // Row universe = active roster ∪ everyone with a current row (an employee
  // archived AFTER being added to the run still has a current row to show).
  const meta = new Map<string, { name: string; branchId: string | null; branchName: string }>();
  for (const e of roster) {
    meta.set(e.id, {
      name: `${e.firstName} ${e.lastName}`,
      branchId: e.branchId,
      branchName: e.branch?.name ?? '—',
    });
  }
  for (const p of current) {
    if (!meta.has(p.employeeId)) {
      meta.set(p.employeeId, {
        name: `${p.employee.firstName} ${p.employee.lastName}`,
        branchId: p.employee.branchId,
        branchName: p.employee.branch?.name ?? '—',
      });
    }
  }

  const rows: ReconRow[] = [];
  for (const [employeeId, m] of meta) {
    const cur = currentByEmp.get(employeeId);
    const current2 = cur ? toBreakdown(cur) : null;
    const baseline = baselineByEmp.get(employeeId) ?? null;
    rows.push({
      employeeId,
      name: m.name,
      branchName: m.branchName,
      current: current2,
      baseline,
      netDeltaAbs: current2 && baseline ? Math.abs(current2.netPay - baseline.netPay) : 0,
      adjustments: adjByEmp.get(employeeId) ?? [],
      flags: flagRow(current2, baseline),
    });
  }

  // Totals + byBranch over current rows only.
  let gross = 0;
  let deductions = 0;
  let net = 0;
  const branchAcc = new Map<
    string,
    { branchId: string; branchName: string; net: number; headcount: number }
  >();
  for (const p of current) {
    const b = toBreakdown(p);
    gross += b.incomeBase + b.incomeAllowance + b.incomeOther;
    deductions +=
      b.deductSso +
      b.deductAdvance +
      b.deductAttendance +
      b.deductLeave +
      b.deductDebt +
      b.deductOther;
    net += b.netPay;
    const branchName = p.employee.branch?.name ?? '—';
    const key = p.employee.branchId ?? '—';
    const acc = branchAcc.get(key) ?? {
      branchId: p.employee.branchId ?? '—',
      branchName,
      net: 0,
      headcount: 0,
    };
    acc.net += b.netPay;
    acc.headcount += 1;
    branchAcc.set(key, acc);
  }

  const anyStatus = (s: 'Draft' | 'Published' | 'Locked') => current.some((p) => p.status === s);
  const status: ReconciliationView['status'] =
    current.length === 0
      ? 'None'
      : anyStatus('Draft')
        ? 'Draft'
        : anyStatus('Published')
          ? 'Published'
          : 'Locked';

  return {
    month,
    status,
    totals: { gross, deductions, net, headcount: current.length },
    byBranch: [...branchAcc.values()].sort((a, b) => a.branchName.localeCompare(b.branchName)),
    rows,
  };
}
