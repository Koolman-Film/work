import { prisma } from '@/lib/db/prisma';
import { remainingMinutes, resolveGrantedMinutes } from './balance';
import { getLeaveConfig } from './leave-config';
import { deductionForOverQuota, overQuotaMinutesFor, perMinuteRate } from './over-quota';
import { standardDayMinutes } from './units';

export type OverQuotaPreview = {
  policy: 'Block' | 'DeductPay';
  /** Remaining minutes for the request's year (null = unlimited). */
  remaining: number | null;
  /** Minutes the request would charge beyond the entitlement. */
  overQuotaMinutes: number;
  /** Estimated deduction at today's salary (the approval freeze recomputes). */
  estimatedDeduction: number;
};

/** Preview what approving `chargedMinutes` of one type would do to the
 *  employee's entitlement. Read-only; used by the admin review modal.
 *  (The worker form computes its own preview client-side from the same
 *  pure functions — see leave-new-form.tsx.) */
export async function overQuotaPreview(
  employeeId: string,
  leaveTypeId: string,
  year: number,
  chargedMinutes: number,
): Promise<OverQuotaPreview> {
  const [cfg, type, ent, employee, payCfg] = await Promise.all([
    getLeaveConfig(),
    prisma.leaveType.findUniqueOrThrow({
      where: { id: leaveTypeId },
      select: { annualQuota: true, overQuotaPolicy: true },
    }),
    prisma.leaveEntitlement.findUnique({
      where: { employeeId_leaveTypeId_periodYear: { employeeId, leaveTypeId, periodYear: year } },
      select: { grantedMinutes: true, carryoverMinutes: true, adjustmentMinutes: true },
    }),
    prisma.employee.findUniqueOrThrow({
      where: { id: employeeId },
      select: { salaryType: true, baseSalary: true },
    }),
    prisma.payrollConfig.findFirstOrThrow({ select: { workingDaysPerMonth: true } }),
  ]);
  const std = standardDayMinutes(cfg);
  const granted = resolveGrantedMinutes(type.annualQuota, ent, std);
  const usedRows = await prisma.leaveRequest.findMany({
    where: {
      employeeId,
      leaveTypeId,
      status: 'Approved',
      deletedAt: null,
      startDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
    },
    select: { chargedMinutes: true },
  });
  const used = usedRows.reduce((s, r) => s + (r.chargedMinutes ?? 0), 0);
  const remaining = remainingMinutes(
    {
      grantedMinutes: granted,
      carryoverMinutes: ent?.carryoverMinutes ?? 0,
      adjustmentMinutes: ent?.adjustmentMinutes ?? 0,
    },
    used,
  );
  const over = overQuotaMinutesFor(chargedMinutes, remaining);
  const rate = perMinuteRate(
    employee.salaryType,
    Number(employee.baseSalary),
    payCfg.workingDaysPerMonth,
    std,
  );
  return {
    policy: type.overQuotaPolicy,
    remaining,
    overQuotaMinutes: over,
    estimatedDeduction: deductionForOverQuota(over, rate),
  };
}
