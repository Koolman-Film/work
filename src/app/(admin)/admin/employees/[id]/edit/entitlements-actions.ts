'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { auditLog } from '@/lib/audit/log';
import { canActOnEmployeeBranches, getPermittedBranches } from '@/lib/auth/branch-scope';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { getLeaveConfig } from '@/lib/leave/leave-config';
import { adjustmentToMinutes, standardDayMinutes } from '@/lib/leave/units';

// granted/carryover are DECIMAL DAYS; adjustment is a decimal value in the unit
// named by `adjustmentUnit` (วัน or ชม.). All are converted to minutes below.
const Schema = z.object({
  granted: z
    .union([
      z
        .string()
        .trim()
        .length(0)
        .transform(() => null),
      z.coerce.number().min(0).max(366),
    ])
    .nullable(),
  carryover: z.coerce.number().min(0).max(366),
  adjustment: z.coerce.number().finite(),
  adjustmentUnit: z.enum(['day', 'hour']).catch('day'),
  note: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

export async function upsertEntitlement(
  employeeId: string,
  leaveTypeId: string,
  year: number,
  formData: FormData,
) {
  const { user } = await requirePermission('leave.entitlement.manage');

  const path = `/admin/employees/${employeeId}/edit`;
  const back = `${path}?year=${year}`;

  const parsed = Schema.safeParse({
    granted: formData.get('granted') ?? '',
    carryover: formData.get('carryover') ?? 0,
    adjustment: formData.get('adjustment') ?? 0,
    adjustmentUnit: formData.get('adjustmentUnit') ?? 'day',
    note: formData.get('note') ?? undefined,
  });
  if (!parsed.success) {
    redirect(
      `${back}&error=${encodeURIComponent(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง')}`,
    );
  }

  const emp = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { branchId: true, assignedBranchIds: true },
  });
  if (!emp) {
    notFound();
  }
  if (
    !canActOnEmployeeBranches(await getPermittedBranches(user, 'leave.entitlement.manage'), [
      emp.branchId,
      ...emp.assignedBranchIds,
    ])
  ) {
    notFound();
  }

  const std = standardDayMinutes(await getLeaveConfig());
  const toMin = (days: number) => Math.round(days * std);
  // adjustment carries its own unit; convert then bound to ±366 days of minutes
  // (the same ±366-day range granted/carryover use), so the hour path can't
  // sneak past the day-based limit.
  const adjustmentMinutes = adjustmentToMinutes(
    parsed.data.adjustment,
    parsed.data.adjustmentUnit,
    std,
  );
  if (Math.abs(adjustmentMinutes) > 366 * std) {
    redirect(`${back}&error=${encodeURIComponent('ค่าปรับปรุงเกินช่วงที่กำหนด (สูงสุด 366 วัน)')}`);
  }
  const data = {
    grantedMinutes: parsed.data.granted == null ? null : toMin(parsed.data.granted),
    carryoverMinutes: toMin(parsed.data.carryover),
    adjustmentMinutes,
    note: parsed.data.note,
  };

  const key = {
    employeeId_leaveTypeId_periodYear: { employeeId, leaveTypeId, periodYear: year },
  };
  const before = await prisma.leaveEntitlement.findUnique({ where: key });
  const row = await prisma.leaveEntitlement.upsert({
    where: key,
    create: { employeeId, leaveTypeId, periodYear: year, ...data },
    update: data,
  });

  auditLog({
    actorId: user.id,
    action: 'leaveEntitlement.update',
    entityType: 'LeaveEntitlement',
    entityId: row.id,
    before: before
      ? {
          grantedMinutes: before.grantedMinutes,
          carryoverMinutes: before.carryoverMinutes,
          adjustmentMinutes: before.adjustmentMinutes,
          note: before.note,
        }
      : undefined,
    after: data,
    metadata: { source: 'admin-ui', leaveTypeId, periodYear: year },
  });

  revalidatePath(path);
  redirect(`${back}&ok=1`);
}
