import { prisma } from '@/lib/db/prisma';
import { windowMinutes } from '@/lib/leave/units';
import { type AdvanceBalance, calculateAdvanceBalance } from './balance';
import { payrollPeriodFor, periodEarnings } from './period-earnings';

/**
 * The one place that answers "how much can this employee still draw?".
 * Used by the LIFF advance page/form AND the admin approval guard so the
 * two can never disagree.
 *
 * Concurrency backstop: the partial-unique "one Pending advance per employee"
 * index (migration 0021) prevents double-spend races; this read-only helper
 * is not a lock.
 *
 * @param excludeAdvanceId omit one advance from "reserved" — pass the id of
 *   the advance being approved so it doesn't count against itself.
 *
 * Perf: 3-4 queries per call — fine for form/approval; report code should
 * avoid looping this over all employees; advanceReport
 * (src/lib/reports/queries.ts) deliberately accepts the per-employee cost for
 * current-cap columns — bounded by headcount and parallelized.
 */
export async function advanceBalanceFor(
  employeeId: string,
  excludeAdvanceId?: string,
): Promise<AdvanceBalance> {
  const employee = await prisma.employee.findUniqueOrThrow({
    where: { id: employeeId },
    select: { baseSalary: true, salaryType: true, workScheduleId: true },
  });

  // config only needed for non-Monthly; fetch employee first then parallelize
  const [reservedRows, cfg] = await Promise.all([
    prisma.cashAdvance.findMany({
      where: {
        employeeId,
        deletedAt: null,
        ...(excludeAdvanceId ? { id: { not: excludeAdvanceId } } : {}),
        OR: [{ status: 'Pending' }, { status: 'Approved', isDeducted: false }],
      },
      select: { status: true, amount: true },
    }),
    employee.salaryType !== 'Monthly'
      ? prisma.payrollConfig.findFirstOrThrow({ select: { cutoffDay: true } })
      : Promise.resolve(null),
  ]);

  let earnings: number | null = null;
  if (employee.salaryType !== 'Monthly' && cfg) {
    const todayYmd = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
    const period = payrollPeriodFor(todayYmd, cfg.cutoffDay);
    const rows = await prisma.attendance.findMany({
      where: {
        employeeId,
        deletedAt: null,
        type: 'CheckIn',
        // Rejected check-ins were ruled invalid by an admin — they must not
        // raise the cap. Disputed (unreviewed) still counts; the admin sees
        // the final number at approval anyway.
        checkInStatus: { not: 'Rejected' },
        date: {
          gte: new Date(`${period.start}T00:00:00.000Z`),
          lte: new Date(`${period.end}T00:00:00.000Z`),
        },
      },
      select: { date: true, clockInAt: true, clockOutAt: true },
    });

    // For Hourly employees, clamp creditable minutes per day to the scheduled
    // shift length to guard against forced-checkout inflation (EOD job closes
    // open check-ins at 22:00). No schedule → no clamp.
    let maxMinutesByDow: Partial<Record<number, number>> | undefined;
    if (employee.salaryType === 'Hourly' && employee.workScheduleId) {
      const scheduleDays = await prisma.workScheduleDay.findMany({
        where: { workScheduleId: employee.workScheduleId },
        select: { dayOfWeek: true, startTime: true, endTime: true },
      });
      maxMinutesByDow = Object.fromEntries(
        scheduleDays.map((d) => [d.dayOfWeek, windowMinutes(d.startTime, d.endTime)]),
      );
    }

    earnings = periodEarnings(
      employee.salaryType,
      Number(employee.baseSalary),
      rows,
      maxMinutesByDow,
    );
  }

  return calculateAdvanceBalance({
    baseSalary: employee.baseSalary,
    salaryType: employee.salaryType,
    // Type-cast: Prisma's AdvanceStatus enum includes Rejected/Cancelled
    // too, but our `where` clause filtered those out. The balance helper
    // only handles Pending/Approved.
    reservedAdvances: reservedRows as Array<{
      status: 'Pending' | 'Approved';
      amount: (typeof reservedRows)[number]['amount'];
    }>,
    periodEarnings: earnings,
  });
}
