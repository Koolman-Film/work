/**
 * Adding / removing a branch's payroll cut-off override.
 *
 * A row with fromMonth F re-windows that branch's months from F onward (until
 * the next row). So both adding and removing are refused while ANY of the
 * branch's employees has a Published/Locked payslip for a month ≥ F: that
 * payslip was paid against the old window, and moving it would put days on
 * two payslips or on none. Drafts are fine — they are recalculated.
 *
 * "The branch's employees" = current home-branch employees. Someone who moved
 * branch since is not covered; moving an employee between branches with
 * different cut-offs is its own transition and is out of scope here.
 */
import { auditLogTx } from '@/lib/audit/log';
import { prisma } from '@/lib/db/prisma';
import { isValidBranchCutoffDay, isValidMonth } from './cutoff-rule';

export type BranchCutoffResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'invalid' | 'branch-not-found' | 'duplicate' | 'not-found' | 'frozen';
      /** For 'frozen': the latest paid month that blocks the change. */
      frozenMonth?: string;
    };

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

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
