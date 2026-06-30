import { prisma } from '@/lib/db/prisma';
import { standardDayMinutes } from '@/lib/leave/units';
import { payrollRowDetailRaw } from '@/lib/payroll/run';
import { assemblePayslipDocument, type NormalizedPayslipInput } from './document';
import type { PayslipDocument } from './types';

const LEAVE_DEFAULTS = {
  morningStart: '09:00',
  morningEnd: '12:00',
  afternoonStart: '13:00',
  afternoonEnd: '17:00',
};

export async function buildPreviewPayslipDocument(
  month: string,
  employeeId: string,
): Promise<PayslipDocument | null> {
  const raw = await payrollRowDetailRaw(month, employeeId);
  if (!raw) return null;

  const [employee, leaveConfig] = await Promise.all([
    prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        firstName: true,
        lastName: true,
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
    prisma.leaveConfig.findFirst(),
  ]);
  if (!employee) return null;

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
      payType: raw.employee.salaryType,
      month,
    },
    buckets: raw.buckets,
    incomeAdjustments: raw.incomeAdjustments,
    deductAdjustments: raw.deductAdjustments,
    advanceCount: raw.advanceCount,
    attendance: raw.attendance,
    leaveOverMinutesTotal: raw.leaveOverMinutesTotal,
    rateInputs: {
      ssoRate: raw.config.ssoRate,
      ssoSalaryCap: raw.config.ssoSalaryCap,
      salaryType: raw.employee.salaryType,
      baseSalary: raw.employee.baseSalary,
      workingDaysPerMonth: raw.config.workingDaysPerMonth,
      standardDayMinutes: standardDayMinutes(leaveConfig ?? LEAVE_DEFAULTS),
    },
  };

  return assemblePayslipDocument(input);
}
