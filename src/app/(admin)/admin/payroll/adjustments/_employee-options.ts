import { prisma } from '@/lib/db/prisma';
import type { EmployeeOption } from './adjustment-form';

/** Non-archived employees as select options, alphabetical by first name. */
export async function loadEmployeeOptions(): Promise<EmployeeOption[]> {
  const employees = await prisma.employee.findMany({
    where: { status: { not: 'Archived' } },
    orderBy: { firstName: 'asc' },
    select: { id: true, firstName: true, lastName: true, nickname: true },
  });
  return employees.map((e) => ({
    id: e.id,
    label: `${e.firstName} ${e.lastName}${e.nickname ? ` (${e.nickname})` : ''}`,
  }));
}
