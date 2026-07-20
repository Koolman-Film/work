import { prisma } from '@/lib/db/prisma';
import { perMinuteRate } from '@/lib/leave/over-quota';
import { standardDayMinutes } from '@/lib/leave/units';
import { adjustmentAppliesToMonth } from '@/lib/payroll/adjustments';
import {
  EMPTY_SETTLEMENT,
  type PenaltyKindKey,
  type SettlementDays,
} from '@/lib/payroll/penalty-settlement';
import { loadSettlementsForMonth } from '@/lib/payroll/penalty-settlement-load';
import { payrollMonthWindow } from '@/lib/payroll/period';
import type { PayslipDocument, PayslipLine } from './types';

export type { PayslipDocument, PayslipLine } from './types';

export type NormalizedPayslipInput = {
  meta: {
    employeeName: string;
    employeeId: string;
    branch: string;
    branchEn: string | null;
    letterhead: {
      payslipNameEn: string | null;
      payslipNameNative: string | null;
      payslipLogoKey: string | null;
    };
    department: string | null;
    payType: 'Monthly' | 'Daily' | 'Hourly';
    month: string;
  };
  buckets: {
    incomeBase: number;
    incomeOther: number;
    deductSso: number;
    deductAdvance: number;
    deductAttendance: number;
    deductLeave: number;
    deductDebt: number;
    deductOther: number;
    netPay: number;
  };
  /** Income-kind adjustments that apply to this month, in display order. */
  incomeAdjustments: { id: string; reason: string; amount: number }[];
  /** Deduction-kind adjustments that apply to this month, in display order. */
  deductAdjustments: { id: string; reason: string; amount: number }[];
  /** Number of cash advances feeding deductAdvance (for the line detail count). */
  advanceCount: number;
  /** Attendance counts over the pay period (for the attendance line detail). */
  attendance: { absent: number; late: number };
  /**
   * Days of each attendance-penalty kind settled with leave this month
   * instead of money — omit (or leave a kind out) when nothing of that kind
   * was settled, the default and the state of almost every payslip. Drives a
   * dedicated zero-amount line per settled kind (see settled-with-leave note
   * below) so the employee is told which leave type paid for it, even in a
   * month where that nets `deductAttendance` all the way to zero and the
   * ordinary attendance line is omitted entirely.
   */
  settledDays?: Partial<SettlementDays>;
  /**
   * Which leave type absorbed each settled kind — for the note's wording.
   * Carries both the Thai canonical `name` and the optional `nameByLocale`
   * map so the renderer (which knows the locale; this module deliberately
   * does not) can localize the note per employee.
   */
  settledLeaveTypeNames?: Partial<Record<PenaltyKindKey, { name: string; nameByLocale: unknown }>>;
  /** Sum of over-quota leave minutes (for the leave line detail). */
  leaveOverMinutesTotal: number;
  /** Inputs the assembler needs to compute the SSO% label and the leave per-minute rate. */
  rateInputs: {
    ssoRate: number;
    ssoSalaryCap: number;
    salaryType: 'Monthly' | 'Daily' | 'Hourly';
    baseSalary: number;
    workingDaysPerMonth: number;
    standardDayMinutes: number;
  };
};

export function assemblePayslipDocument(input: NormalizedPayslipInput): PayslipDocument {
  const {
    meta,
    buckets,
    incomeAdjustments,
    deductAdjustments,
    advanceCount,
    attendance,
    settledDays,
    settledLeaveTypeNames,
    leaveOverMinutesTotal,
    rateInputs,
  } = input;

  // ── Income
  const income: PayslipLine[] = [
    { key: 'base', labelKey: 'income.base', amount: buckets.incomeBase, detail: null },
  ];
  const incomeAdjSum = incomeAdjustments.reduce((s, a) => s + a.amount, 0);
  if (incomeAdjustments.length > 0 && incomeAdjSum === buckets.incomeOther) {
    for (const a of incomeAdjustments)
      income.push({ key: a.id, label: a.reason, amount: a.amount, detail: null });
  } else if (buckets.incomeOther !== 0) {
    income.push({
      key: 'other',
      labelKey: 'income.other',
      amount: buckets.incomeOther,
      detail: null,
    });
  }

  // ── Deductions
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
    buckets.deductSso !== 0
      ? {
          key: 'sso',
          vars: {
            pct: Math.round(rateInputs.ssoRate * 100),
            cap: rateInputs.ssoSalaryCap.toLocaleString('en-US'),
          },
        }
      : null;
  push('sso', 'deduct.sso', buckets.deductSso, ssoDetail);

  const advDetail = advanceCount > 0 ? { key: 'advance', vars: { count: advanceCount } } : null;
  push('advance', 'deduct.advance', buckets.deductAdvance, advDetail);

  let attDetail: PayslipLine['detail'] = null;
  if (buckets.deductAttendance !== 0 && attendance.absent + attendance.late > 0) {
    attDetail = { key: 'attendance', vars: { absent: attendance.absent, late: attendance.late } };
  }
  push('attendance', 'deduct.attendance', buckets.deductAttendance, attDetail);

  // A penalty settled with leave nets its own money to zero — sometimes
  // taking the whole `deductAttendance` bucket to zero too, which makes the
  // `push()` above skip the attendance line entirely. Without a separate,
  // always-shown line here, the employee would see nothing for that penalty
  // and read the silence as "it didn't happen," only to find the leave days
  // missing later. This loop is independent of `deductAttendance` on
  // purpose: each settled kind gets its own ฿0 line naming the leave type
  // that paid for it, keyed so it can only appear once per kind and never
  // appears when that kind was not settled.
  const SETTLED_KIND_LINE_KEY: Record<PenaltyKindKey, string> = {
    Absent: 'settledAbsent',
    LateThreeStrike: 'settledLateThreeStrike',
    SevereLate: 'settledSevereLate',
  };
  // Fallback when a settlement has no leave type name recorded — mirrors the
  // pre-fix behaviour exactly (always the Thai canonical name, in every
  // locale): `nameByLocale: null` means `localizedLeaveTypeName` always
  // falls back to `name`. Not translated further; out of scope for this fix.
  const FALLBACK_LEAVE_TYPE: { name: string; nameByLocale: unknown } = {
    name: 'วันลา',
    nameByLocale: null,
  };
  for (const kind of Object.keys(EMPTY_SETTLEMENT) as PenaltyKindKey[]) {
    const days = settledDays?.[kind] ?? 0;
    if (days <= 0) continue;
    const leaveType = settledLeaveTypeNames?.[kind] ?? FALLBACK_LEAVE_TYPE;
    deduct.push({
      key: SETTLED_KIND_LINE_KEY[kind],
      labelKey: `deduct.${SETTLED_KIND_LINE_KEY[kind]}`,
      vars: { days },
      leaveType,
      amount: 0,
      detail: null,
    });
  }

  const rate = perMinuteRate(
    rateInputs.salaryType,
    rateInputs.baseSalary,
    rateInputs.workingDaysPerMonth,
    rateInputs.standardDayMinutes,
  );
  const leaveDetail =
    leaveOverMinutesTotal > 0
      ? { key: 'leave', vars: { minutes: leaveOverMinutesTotal, rate: rate.toFixed(4) } }
      : null;
  push('leave', 'deduct.leave', buckets.deductLeave, leaveDetail);

  push('debt', 'deduct.debt', buckets.deductDebt);

  const deductAdjSum = deductAdjustments.reduce((s, a) => s + a.amount, 0);
  if (deductAdjustments.length > 0 && deductAdjSum === buckets.deductOther) {
    for (const a of deductAdjustments)
      deduct.push({ key: a.id, label: a.reason, amount: a.amount, detail: null });
  } else if (buckets.deductOther !== 0) {
    deduct.push({
      key: 'other',
      labelKey: 'deduct.other',
      amount: buckets.deductOther,
      detail: null,
    });
  }

  return {
    meta,
    income: { lines: income, total: buckets.incomeBase + buckets.incomeOther },
    deduct: {
      lines: deduct,
      total:
        buckets.deductSso +
        buckets.deductAdvance +
        buckets.deductAttendance +
        buckets.deductLeave +
        buckets.deductDebt +
        buckets.deductOther,
    },
    net: buckets.netPay,
  };
}

export async function getPayslipDocument(
  employeeId: string,
  month: string,
): Promise<PayslipDocument | null> {
  const payroll = await prisma.payroll.findFirst({
    where: { employeeId, month, status: { in: ['Published', 'Locked'] } },
  });
  if (!payroll) return null;

  const [employee, config, leaveConfig, adjustments, advances, leaves, settlement] =
    await Promise.all([
      prisma.employee.findUniqueOrThrow({
        where: { id: employeeId },
        select: {
          firstName: true,
          lastName: true,
          nickname: true,
          salaryType: true,
          baseSalary: true,
          branch: {
            select: {
              name: true,
              nameEn: true,
              payslipNameEn: true,
              payslipNameNative: true,
              payslipLogoKey: true,
            },
          },
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
      // Deliberately NOT gated on payroll.deductAttendance !== 0 (unlike the
      // absent/late counts below): a fully-settled month nets deductAttendance
      // to zero, which is exactly the case that needs this note most.
      loadSettlementsForMonth(month).then((m) => m.get(employeeId)),
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

  const incomeAdj = adjustments.filter(
    (a) => a.kind === 'Income' && adjustmentAppliesToMonth(a, month),
  );
  const deductAdj = adjustments.filter(
    (a) => a.kind === 'Deduction' && adjustmentAppliesToMonth(a, month),
  );

  // Attendance detail — a factual count of absent/late days in the pay period.
  // The frozen amount stays authoritative (3-strike/severe-late rules mean it
  // isn't simply count × rate); this only describes the attendance.
  let attendance = { absent: 0, late: 0 };
  if (n(payroll.deductAttendance) !== 0) {
    const { start, end } = payrollMonthWindow(month, config.cutoffDay);
    const [absent, late] = await Promise.all([
      prisma.attendance.count({
        where: { employeeId, type: 'Absent', date: { gte: start, lte: end }, deletedAt: null },
      }),
      prisma.attendance.count({
        where: { employeeId, type: 'Late', date: { gte: start, lte: end }, deletedAt: null },
      }),
    ]);
    attendance = { absent, late };
  }

  const input: NormalizedPayslipInput = {
    meta: {
      employeeName: `${employee.firstName} ${employee.lastName}`,
      employeeId,
      branch: employee.branch.name,
      branchEn: employee.branch.nameEn,
      letterhead: {
        payslipNameEn: employee.branch.payslipNameEn,
        payslipNameNative: employee.branch.payslipNameNative,
        payslipLogoKey: employee.branch.payslipLogoKey,
      },
      department: employee.department?.name ?? null,
      payType: employee.salaryType,
      month,
    },
    buckets: {
      incomeBase: n(payroll.incomeBase),
      incomeOther: n(payroll.incomeOther),
      deductSso: n(payroll.deductSso),
      deductAdvance: n(payroll.deductAdvance),
      deductAttendance: n(payroll.deductAttendance),
      deductLeave: n(payroll.deductLeave),
      deductDebt: n(payroll.deductDebt),
      deductOther: n(payroll.deductOther),
      netPay: n(payroll.netPay),
    },
    incomeAdjustments: incomeAdj.map((a) => ({ id: a.id, reason: a.reason, amount: n(a.amount) })),
    deductAdjustments: deductAdj.map((a) => ({ id: a.id, reason: a.reason, amount: n(a.amount) })),
    advanceCount: advances.length,
    attendance,
    settledDays: settlement?.days,
    settledLeaveTypeNames: settlement?.leaveTypeNames,
    leaveOverMinutesTotal: leaves.reduce((s, l) => s + (l.overQuotaMinutes ?? 0), 0),
    rateInputs: {
      ssoRate: n(config.ssoRate),
      ssoSalaryCap: n(config.ssoSalaryCap),
      salaryType: employee.salaryType,
      baseSalary: n(employee.baseSalary),
      workingDaysPerMonth: config.workingDaysPerMonth,
      standardDayMinutes: std,
    },
  };

  return assemblePayslipDocument(input);
}
