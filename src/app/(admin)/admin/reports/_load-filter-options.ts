/**
 * Shared loader for the report/payroll branch + department filter dropdowns.
 * Both clusters filter the same Employee set, so they share one loader.
 */

import type { Prisma } from '@prisma/client';
import type { PermittedBranches } from '@/lib/auth/branch-scope';
import { prisma } from '@/lib/db/prisma';

export type FilterOption = { id: string; name: string };

export async function loadReportFilterOptions(permitted: PermittedBranches): Promise<{
  branches: FilterOption[];
  departments: FilterOption[];
}> {
  const branchWhere: Prisma.BranchWhereInput =
    permitted === 'all' ? { archivedAt: null } : { archivedAt: null, id: { in: permitted } };
  const [branches, departments] = await Promise.all([
    prisma.branch.findMany({
      where: branchWhere,
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.department.findMany({
      where: { archivedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);
  return { branches, departments };
}

/**
 * The payroll cutoff day for report period alignment (C8). Reports resolve a
 * month to the same cutoff window as payroll so their counts tie out with
 * payroll deductions. Returns undefined when no config exists → calendar month.
 */
export async function loadPayrollCutoffDay(): Promise<number | undefined> {
  const cfg = await prisma.payrollConfig.findFirst({ select: { cutoffDay: true } });
  return cfg?.cutoffDay;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Guard a searchParam destined for a `@db.Uuid` column. The dropdowns only
 * ever emit real ids, but a hand-edited `?branchId=garbage` would otherwise
 * reach Prisma and throw P2023 (invalid uuid syntax). Returns undefined for
 * anything that isn't a well-formed UUID so the filter is simply ignored.
 */
export function asUuid(v: string | undefined): string | undefined {
  return v && UUID_RE.test(v) ? v : undefined;
}
