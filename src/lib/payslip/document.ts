import { prisma } from '@/lib/db/prisma';
import { perMinuteRate } from '@/lib/leave/over-quota';
import { standardDayMinutes } from '@/lib/leave/units';
import { adjustmentAppliesToMonth } from '@/lib/payroll/adjustments';
import type { PayslipDocument, PayslipLine } from './types';

export type { PayslipDocument, PayslipLine } from './types';

export async function getPayslipDocument(
  employeeId: string,
  month: string,
): Promise<PayslipDocument | null> {
  const payroll = await prisma.payroll.findFirst({
    where: { employeeId, month, status: { in: ['Published', 'Locked'] } },
  });
  if (!payroll) return null;

  const [employee, config, leaveConfig, adjustments, advances, leaves] = await Promise.all([
    prisma.employee.findUniqueOrThrow({
      where: { id: employeeId },
      select: {
        firstName: true,
        lastName: true,
        nickname: true,
        salaryType: true,
        baseSalary: true,
        branch: { select: { name: true } },
        department: { select: { name: true } },
      },
    }),
    prisma.payrollConfig.findFirstOrThrow(),
    prisma.leaveConfig.findFirst(),
    prisma.payrollAdjustment.findMany({
      where: {
        employeeId,
        startMonth: { lte: month },
        OR: [{ endMonth: null }, { endMonth: { gte: month } }],
        deletedAt: null,
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        kind: true,
        reason: true,
        amount: true,
        startMonth: true,
        endMonth: true,
      },
    }),
    prisma.cashAdvance.findMany({
      where: { deductedInPayrollId: payroll.id },
      select: { amount: true },
    }),
    prisma.leaveRequest.findMany({
      where: { deductedInPayrollId: payroll.id },
      select: { overQuotaMinutes: true },
    }),
  ]);

  const n = (d: { toNumber(): number }) => d.toNumber();
  const std = standardDayMinutes(
    leaveConfig ?? {
      morningStart: '09:00',
      morningEnd: '12:00',
      afternoonStart: '13:00',
      afternoonEnd: '17:00',
    },
  );

  // ── Income
  const income: PayslipLine[] = [
    { key: 'base', labelKey: 'income.base', amount: n(payroll.incomeBase), detail: null },
  ];
  const incomeAdj = adjustments.filter(
    (a) => a.kind === 'Income' && adjustmentAppliesToMonth(a, month),
  );
  const incomeAdjSum = incomeAdj.reduce((s, a) => s + n(a.amount), 0);
  if (incomeAdj.length > 0 && incomeAdjSum === n(payroll.incomeOther)) {
    for (const a of incomeAdj)
      income.push({ key: a.id, label: a.reason, amount: n(a.amount), detail: null });
  } else if (n(payroll.incomeOther) !== 0) {
    income.push({
      key: 'other',
      labelKey: 'income.other',
      amount: n(payroll.incomeOther),
      detail: null,
    });
  }

  // ── Deductions (with details where derivable)
  const deduct: PayslipLine[] = [];
  const push = (
    key: string,
    labelKey: string,
    amount: number,
    detail: PayslipLine['detail'] = null,
  ) => {
    if (amount !== 0) deduct.push({ key, labelKey, amount, detail });
  };
  const ssoDetail =
    n(payroll.deductSso) !== 0
      ? {
          key: 'sso',
          vars: {
            pct: Math.round(n(config.ssoRate) * 100),
            cap: n(config.ssoSalaryCap).toLocaleString('en-US'),
          },
        }
      : null;
  push('sso', 'deduct.sso', n(payroll.deductSso), ssoDetail);

  const advDetail =
    advances.length > 0 ? { key: 'advance', vars: { count: advances.length } } : null;
  push('advance', 'deduct.advance', n(payroll.deductAdvance), advDetail);

  push('attendance', 'deduct.attendance', n(payroll.deductAttendance)); // detail deferred

  const totalOver = leaves.reduce((s, l) => s + (l.overQuotaMinutes ?? 0), 0);
  const rate = perMinuteRate(
    employee.salaryType,
    n(employee.baseSalary),
    config.workingDaysPerMonth,
    std,
  );
  const leaveDetail =
    totalOver > 0 ? { key: 'leave', vars: { minutes: totalOver, rate: rate.toFixed(4) } } : null;
  push('leave', 'deduct.leave', n(payroll.deductLeave), leaveDetail);

  push('debt', 'deduct.debt', n(payroll.deductDebt)); // detail deferred

  const deductAdj = adjustments.filter(
    (a) => a.kind === 'Deduction' && adjustmentAppliesToMonth(a, month),
  );
  const deductAdjSum = deductAdj.reduce((s, a) => s + n(a.amount), 0);
  if (deductAdj.length > 0 && deductAdjSum === n(payroll.deductOther)) {
    for (const a of deductAdj)
      deduct.push({ key: a.id, label: a.reason, amount: n(a.amount), detail: null });
  } else if (n(payroll.deductOther) !== 0) {
    deduct.push({
      key: 'other',
      labelKey: 'deduct.other',
      amount: n(payroll.deductOther),
      detail: null,
    });
  }

  return {
    meta: {
      employeeName: `${employee.firstName} ${employee.lastName}`,
      employeeId,
      branch: employee.branch.name,
      department: employee.department?.name ?? null,
      payType: employee.salaryType,
      month,
    },
    income: { lines: income, total: n(payroll.incomeBase) + n(payroll.incomeOther) },
    deduct: {
      lines: deduct,
      total: [
        payroll.deductSso,
        payroll.deductAdvance,
        payroll.deductAttendance,
        payroll.deductLeave,
        payroll.deductDebt,
        payroll.deductOther,
      ].reduce((s, d) => s + n(d), 0),
    },
    net: n(payroll.netPay),
  };
}
