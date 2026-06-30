'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auditLog } from '@/lib/audit/log';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { payrollMoneySchema, toPayrollConfigData } from '@/lib/payroll/money-config';

export async function updatePayrollConfig(formData: FormData) {
  const { user } = await requirePermission('settings.payroll.manage');

  const parsed = payrollMoneySchema.safeParse({
    ssoRatePercent: formData.get('ssoRatePercent'),
    ssoSalaryCap: formData.get('ssoSalaryCap'),
    ssoAmountCap: formData.get('ssoAmountCap'),
    otMultiplier: formData.get('otMultiplier'),
    workingDaysPerMonth: formData.get('workingDaysPerMonth'),
    otThresholdMinutes: formData.get('otThresholdMinutes'),
    absentDeductionPerDay: formData.get('absentDeductionPerDay'),
    lateDeduction: formData.get('lateDeduction'),
    earlyLeaveDeduction: formData.get('earlyLeaveDeduction'),
  });
  if (!parsed.success) {
    redirect(
      `/admin/settings/payroll?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง')}`,
    );
  }

  // PayrollConfig is a seeded singleton — UPDATE only, never create.
  const before = await prisma.payrollConfig.findFirst();
  if (!before) {
    redirect(
      `/admin/settings/payroll?error=${encodeURIComponent('ยังไม่มีการตั้งค่าระบบ (PayrollConfig) — รัน seed ก่อน')}`,
    );
  }

  await prisma.payrollConfig.update({
    where: { id: before.id },
    data: toPayrollConfigData(parsed.data),
  });

  auditLog({
    actorId: user.id,
    action: 'payrollConfig.update',
    entityType: 'PayrollConfig',
    entityId: before.id,
    before: {
      ssoRate: before.ssoRate.toString(),
      ssoSalaryCap: before.ssoSalaryCap.toString(),
      ssoAmountCap: before.ssoAmountCap.toString(),
      otMultiplier: before.otMultiplier.toString(),
      workingDaysPerMonth: before.workingDaysPerMonth,
      otThresholdMinutes: before.otThresholdMinutes,
      absentDeductionPerDay: before.absentDeductionPerDay.toString(),
      lateDeduction: before.lateDeduction.toString(),
      earlyLeaveDeduction: before.earlyLeaveDeduction.toString(),
    },
    after: parsed.data,
    metadata: { source: 'admin-ui', section: 'payroll-money' },
  });

  revalidatePath('/admin/settings/payroll');
  redirect('/admin/settings/payroll?ok=1');
}
