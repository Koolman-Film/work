/**
 * Shared loader for the EmployeeForm's select options.
 * Used by both /new and /[id]/edit pages.
 */

import { prisma } from '@/lib/db/prisma';
import type { EmployeeFormOptions } from './employee-form';

export async function loadEmployeeFormOptions(): Promise<EmployeeFormOptions> {
  const [branches, departments, accountingGroups, workSchedules] = await Promise.all([
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
    prisma.accountingGroup.findMany({
      where: { archivedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.workSchedule.findMany({
      where: { archivedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);
  return { branches, departments, accountingGroups, workSchedules };
}
