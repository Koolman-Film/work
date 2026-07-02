'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { auditLog } from '@/lib/audit/log';
import { canActOnEmployeeBranches, getPermittedBranches } from '@/lib/auth/branch-scope';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { isLocale } from '@/lib/i18n/config';

/**
 * Admin sets/changes the default language for an employee. Writes the
 * linked User.locale (the effective preference; last-write-wins with the
 * worker). Deliberately does NOT touch localeChosenByEmployeeAt — an
 * admin re-override must not retrigger the worker's first-run modal, and
 * the worker can still switch again afterwards. An empty value clears
 * the default (back to detection on the worker's next visit).
 */
export async function setEmployeeDefaultLocale(employeeId: string, formData: FormData) {
  const { user: actor } = await requirePermission('employee.update');

  const path = `/admin/employees/${employeeId}/edit`;
  const raw = formData.get('locale');
  const next = typeof raw === 'string' && raw.length > 0 ? raw : null;

  if (next !== null && !isLocale(next)) {
    redirect(`${path}?error=${encodeURIComponent('ภาษาที่เลือกไม่ถูกต้อง')}`);
  }

  const emp = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      branchId: true,
      assignedBranchIds: true,
      user: { select: { id: true, locale: true } },
    },
  });
  if (!emp?.user) {
    redirect(`${path}?error=${encodeURIComponent('ไม่พบบัญชีผู้ใช้ของพนักงาน')}`);
  }
  if (
    !canActOnEmployeeBranches(await getPermittedBranches(actor, 'employee.update'), [
      emp.branchId,
      ...emp.assignedBranchIds,
    ])
  ) {
    notFound();
  }

  const before = emp.user.locale;
  await prisma.user.update({
    where: { id: emp.user.id },
    data: { locale: next },
  });

  auditLog({
    actorId: actor.id,
    action: 'user.locale-change',
    entityType: 'User',
    entityId: emp.user.id,
    before: { locale: before },
    after: { locale: next },
    metadata: { source: 'admin-ui', employeeId },
  });

  revalidatePath(path);
  redirect(`${path}?ok=1`);
}
