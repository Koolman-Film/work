/**
 * Shared loader for the report/payroll branch + department filter dropdowns.
 * Both clusters filter the same Employee set, so they share one loader.
 */

import { prisma } from '@/lib/db/prisma';

export type FilterOption = { id: string; name: string };

export async function loadReportFilterOptions(): Promise<{
  branches: FilterOption[];
  departments: FilterOption[];
}> {
  const [branches, departments] = await Promise.all([
    prisma.branch.findMany({
      where: { archivedAt: null },
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
