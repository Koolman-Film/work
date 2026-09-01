import { prisma } from '@/lib/db/prisma';
import { standardDayMinutes } from '@/lib/leave/units';
import { payrollRowDetailRaw } from '@/lib/payroll/run';
import { assemblePayslipDocument, type NormalizedPayslipInput } from './document';
import type { PayslipDocument } from './types';

/**
 * Which document a preview should render for a payroll row. Drafts recompute
 * live (numbers can still change); Published/Locked render the FROZEN slip —
 * the same bytes the employee got — so the admin preview never silently drifts
 * from reality after a post-publish adjustment edit.
 */
export function pickPreviewSource(
  status: 'Draft' | 'Published' | 'Locked',
): 'recompute' | 'frozen' {
  return status === 'Draft' ? 'recompute' : 'frozen';
}

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
    buckets: {
      ...raw.buckets,
      incomeAllowanceLabel: raw.employee.allowanceLabel,
    },
    incomeAdjustments: raw.incomeAdjustments,
    deductAdjustments: raw.deductAdjustments,
    advanceCount: raw.advanceCount,
    attendance: raw.attendance,
    settledDays: raw.settledDays,
    settledLeaveTypeNames: raw.settledLeaveTypeNames,
    leaveOverMinutesTotal: raw.leaveOverMinutesTotal,
    // Empty on purpose: this path previews a DRAFT, and the per-request leave
    // detail is only carried on the frozen `deductedInPayrollId` link, which a
    // draft has not been stamped with yet. `itemiseLeaveCharges` treats an empty
    // list as "cannot itemise" and falls back to the single aggregate leave
    // line, so the draft preview shows exactly what it showed before. Once the
    // month is published `pickPreviewSource` switches this preview to the frozen
    // document, which itemises — so the admin and the employee see the same slip
    // for every month that has actually been issued.
    sweptLeaves: [],
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
