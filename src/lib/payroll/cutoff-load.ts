/**
 * Loads payroll cut-off rules from the DB. The ONE place that reads
 * PayrollConfig.cutoffDay for window math — everything else asks for a
 * CutoffRule here, so a branch override can't be bypassed by a stray
 * `findFirst({ select: { cutoffDay } })` (cutoff-guard.test.ts enforces it).
 *
 * The rule follows the employee's HOME branch (`Employee.branchId`), never
 * where they checked in: Central Audio staff are also assigned to other
 * branches, and a payslip has exactly one window.
 */
import { prisma } from '@/lib/db/prisma';
import type { BranchCutoff, CutoffRule } from './cutoff-rule';

/** Matches `PayrollConfig.cutoffDay`'s schema default — the fallback every
 *  caller used before this module existed when no config row is present. */
export const DEFAULT_CUTOFF_DAY = 25;

type Db = Pick<typeof prisma, 'payrollConfig' | 'branchPayrollCutoff' | 'employee'>;

export type CutoffRules = {
  globalCutoffDay: number;
  /** The rule for employees whose home branch is `branchId`. Null/unknown → company day. */
  forBranch(branchId: string | null | undefined): CutoffRule;
  /** Branches with at least one override, for UI labels. */
  overridesByBranch: ReadonlyMap<string, readonly BranchCutoff[]>;
};

export async function loadCutoffRules(db: Db = prisma): Promise<CutoffRules> {
  const [cfg, rows] = await Promise.all([
    db.payrollConfig.findFirst({ select: { cutoffDay: true } }),
    db.branchPayrollCutoff.findMany({
      select: { branchId: true, fromMonth: true, cutoffDay: true },
    }),
  ]);
  const globalCutoffDay = cfg?.cutoffDay ?? DEFAULT_CUTOFF_DAY;
  const byBranch = new Map<string, BranchCutoff[]>();
  for (const r of rows) {
    const list = byBranch.get(r.branchId) ?? [];
    list.push({ fromMonth: r.fromMonth, cutoffDay: r.cutoffDay });
    byBranch.set(r.branchId, list);
  }
  return {
    globalCutoffDay,
    forBranch: (branchId) => ({
      globalCutoffDay,
      overrides: (branchId && byBranch.get(branchId)) || [],
    }),
    overridesByBranch: byBranch,
  };
}

/** The rule for one employee (their home branch). Unknown employee → company day. */
export async function loadCutoffForEmployee(
  employeeId: string,
  db: Db = prisma,
): Promise<CutoffRule> {
  const [rules, emp] = await Promise.all([
    loadCutoffRules(db),
    db.employee.findUnique({ where: { id: employeeId }, select: { branchId: true } }),
  ]);
  return rules.forBranch(emp?.branchId);
}
