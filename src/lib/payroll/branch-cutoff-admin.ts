/**
 * Adding / removing a branch's payroll cut-off override.
 *
 * A row with fromMonth F re-windows that branch's months from F onward (until
 * the next row). So both adding and removing are refused while ANY of the
 * branch's employees has a Published/Locked payslip for a month ≥ F: that
 * payslip was paid against the old window, and moving it would put days on
 * two payslips or on none. Drafts are fine — they are recalculated.
 *
 * "The branch's employees" = current home-branch employees. Moving an
 * employee between branches with different cut-offs is guarded separately by
 * `branchMoveBlockedByPaidMonth` below.
 *
 * Both take the payroll month lock (month-lock.ts) for every month the change
 * affects, the same lock publishPayroll holds while it reads the rules and
 * writes Published rows. Without it a publish could compute 2026-10 under the
 * old rule and commit while the override commits beside it.
 */
import { auditLogTx } from '@/lib/audit/log';
import { prisma } from '@/lib/db/prisma';
import { loadCutoffRules } from './cutoff-load';
import { isValidBranchCutoffDay, isValidMonth, rulesAgreeFrom } from './cutoff-rule';
import { lockPayrollMonth } from './month-lock';

export type BranchCutoffResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'invalid' | 'branch-not-found' | 'duplicate' | 'not-found' | 'frozen' | 'busy';
      /** For 'frozen': the latest paid month that blocks the change. */
      frozenMonth?: string;
    };

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

function nextMonth(ym: string): string {
  const [y, m] = [Number(ym.slice(0, 4)), Number(ym.slice(5, 7))];
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
}

/** Lock every month from `fromMonth` to the latest month any payroll row
 *  exists for. False = a publish/draft/settlement holds one right now. */
async function lockAffectedMonths(tx: Tx, fromMonth: string): Promise<boolean> {
  const latest = await tx.payroll.findFirst({
    orderBy: { month: 'desc' },
    select: { month: true },
  });
  const last = latest && latest.month > fromMonth ? latest.month : fromMonth;
  for (let m = fromMonth; m <= last; m = nextMonth(m)) {
    if (!(await lockPayrollMonth(tx, m))) return false;
  }
  return true;
}

async function latestFrozenMonthFrom(tx: Tx, branchId: string, fromMonth: string) {
  const row = await tx.payroll.findFirst({
    where: {
      employee: { branchId },
      status: { in: ['Published', 'Locked'] },
      month: { gte: fromMonth },
    },
    orderBy: { month: 'desc' },
    select: { month: true },
  });
  return row?.month ?? null;
}

export async function addBranchCutoff(input: {
  branchId: string;
  fromMonth: string;
  cutoffDay: number;
  actorId: string;
}): Promise<BranchCutoffResult> {
  const { branchId, fromMonth, cutoffDay, actorId } = input;
  if (!isValidMonth(fromMonth) || !isValidBranchCutoffDay(cutoffDay)) {
    return { ok: false, reason: 'invalid' };
  }
  return prisma.$transaction(async (tx) => {
    const branch = await tx.branch.findUnique({
      where: { id: branchId },
      select: { archivedAt: true },
    });
    if (!branch || branch.archivedAt) return { ok: false, reason: 'branch-not-found' } as const;
    if (!(await lockAffectedMonths(tx, fromMonth))) return { ok: false, reason: 'busy' } as const;

    const frozenMonth = await latestFrozenMonthFrom(tx, branchId, fromMonth);
    if (frozenMonth) return { ok: false, reason: 'frozen', frozenMonth } as const;

    const existing = await tx.branchPayrollCutoff.findUnique({
      where: { branchId_fromMonth: { branchId, fromMonth } },
      select: { id: true },
    });
    if (existing) return { ok: false, reason: 'duplicate' } as const;

    const created = await tx.branchPayrollCutoff.create({
      data: { branchId, fromMonth, cutoffDay, createdById: actorId },
    });
    await auditLogTx(tx, {
      actorId,
      action: 'branchPayrollCutoff.create',
      entityType: 'BranchPayrollCutoff',
      entityId: created.id,
      after: { branchId, fromMonth, cutoffDay },
      metadata: { source: 'admin-ui' },
    });
    return { ok: true } as const;
  });
}

export async function removeBranchCutoff(input: {
  id: string;
  actorId: string;
}): Promise<BranchCutoffResult> {
  return prisma.$transaction(async (tx) => {
    const row = await tx.branchPayrollCutoff.findUnique({ where: { id: input.id } });
    if (!row) return { ok: false, reason: 'not-found' } as const;
    if (!(await lockAffectedMonths(tx, row.fromMonth)))
      return { ok: false, reason: 'busy' } as const;

    const frozenMonth = await latestFrozenMonthFrom(tx, row.branchId, row.fromMonth);
    if (frozenMonth) return { ok: false, reason: 'frozen', frozenMonth } as const;

    await tx.branchPayrollCutoff.delete({ where: { id: row.id } });
    await auditLogTx(tx, {
      actorId: input.actorId,
      action: 'branchPayrollCutoff.delete',
      entityType: 'BranchPayrollCutoff',
      entityId: row.id,
      before: { branchId: row.branchId, fromMonth: row.fromMonth, cutoffDay: row.cutoffDay },
      metadata: { source: 'admin-ui' },
    });
    return { ok: true } as const;
  });
}

/**
 * Would moving this employee's home branch from `fromBranchId` to `toBranchId`
 * re-window a payslip they have already been paid? Returns the earliest
 * Published/Locked month that blocks the move, or null when it is safe — no
 * paid payslip yet, or both branches give identical windows from it onward.
 *
 * Refusing is deliberately conservative: a move between a month-end branch and
 * a company-day branch after the first paid month would need its own
 * stretched/shortened transition month, which nothing models yet.
 */
export async function branchMoveBlockedByPaidMonth(
  employeeId: string,
  fromBranchId: string,
  toBranchId: string,
): Promise<string | null> {
  if (fromBranchId === toBranchId) return null;
  const earliest = await prisma.payroll.findFirst({
    where: { employeeId, status: { in: ['Published', 'Locked'] } },
    orderBy: { month: 'asc' },
    select: { month: true },
  });
  if (!earliest) return null;
  const rules = await loadCutoffRules();
  return rulesAgreeFrom(earliest.month, rules.forBranch(fromBranchId), rules.forBranch(toBranchId))
    ? null
    : earliest.month;
}
