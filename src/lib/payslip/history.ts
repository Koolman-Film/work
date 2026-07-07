// src/lib/payslip/history.ts
import 'server-only';
import { type PermittedBranches, viaEmployeeBranchScope } from '@/lib/auth/branch-scope';
import { prisma } from '@/lib/db/prisma';

/** An employee's own Published/Locked payslip history, newest month first. */
export async function loadEmployeePayslipHistory(
  employeeId: string,
): Promise<{ month: string; netPay: number }[]> {
  const rows = await prisma.payroll.findMany({
    where: { employeeId, status: { in: ['Published', 'Locked'] } },
    orderBy: { month: 'desc' },
    select: { month: true, netPay: true },
  });
  return rows.map((r) => ({ month: r.month, netPay: r.netPay.toNumber() }));
}

/** All employees with a frozen (Published/Locked) payslip for `month`, branch-scoped. */
export async function loadMonthPayslipTargets(
  month: string,
  permitted: PermittedBranches,
): Promise<{ employeeId: string; name: string }[]> {
  const rows = await prisma.payroll.findMany({
    where: {
      month,
      status: { in: ['Published', 'Locked'] },
      ...viaEmployeeBranchScope(permitted),
    },
    orderBy: { employee: { firstName: 'asc' } },
    select: { employeeId: true, employee: { select: { firstName: true, lastName: true } } },
  });
  return rows.map((r) => ({
    employeeId: r.employeeId,
    name: `${r.employee.firstName} ${r.employee.lastName}`,
  }));
}
