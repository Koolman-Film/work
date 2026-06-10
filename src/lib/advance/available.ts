import { prisma } from '@/lib/db/prisma';
import { type AdvanceBalance, calculateAdvanceBalance } from './balance';
import { payrollPeriodFor, periodEarnings } from './period-earnings';

/**
 * The one place that answers "how much can this employee still draw?".
 * Used by the LIFF advance page/form AND the admin approval guard so the
 * two can never disagree.
 *
 * @param excludeAdvanceId omit one advance from "reserved" — pass the id of
 *   the advance being approved so it doesn't count against itself.
 */
export async function advanceBalanceFor(
  employeeId: string,
  excludeAdvanceId?: string,
): Promise<AdvanceBalance> {
  const employee = await prisma.employee.findUniqueOrThrow({
    where: { id: employeeId },
    select: { baseSalary: true, salaryType: true },
  });

  const reservedRows = await prisma.cashAdvance.findMany({
    where: {
      employeeId,
      deletedAt: null,
      ...(excludeAdvanceId ? { id: { not: excludeAdvanceId } } : {}),
      OR: [{ status: 'Pending' }, { status: 'Approved', isDeducted: false }],
    },
    select: { status: true, amount: true },
  });

  let earnings: number | null = null;
  if (employee.salaryType !== 'Monthly') {
    const cfg = await prisma.payrollConfig.findFirstOrThrow({ select: { cutoffDay: true } });
    const todayYmd = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
    const period = payrollPeriodFor(todayYmd, cfg.cutoffDay);
    const rows = await prisma.attendance.findMany({
      where: {
        employeeId,
        deletedAt: null,
        type: 'CheckIn',
        date: {
          gte: new Date(`${period.start}T00:00:00.000Z`),
          lte: new Date(`${period.end}T00:00:00.000Z`),
        },
      },
      select: { date: true, clockInAt: true, clockOutAt: true },
    });
    earnings = periodEarnings(employee.salaryType, Number(employee.baseSalary), rows);
  }

  return calculateAdvanceBalance({
    baseSalary: employee.baseSalary,
    salaryType: employee.salaryType,
    reservedAdvances: reservedRows as Array<{
      status: 'Pending' | 'Approved';
      amount: (typeof reservedRows)[number]['amount'];
    }>,
    periodEarnings: earnings,
  });
}
