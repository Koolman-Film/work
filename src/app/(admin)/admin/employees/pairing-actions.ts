'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auditLog } from '@/lib/audit/log';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { mintPairingToken } from '@/lib/pairing/token';

/**
 * Generate (or regenerate) a LINE pairing link for an employee.
 *
 * Idempotent in spirit — calling it twice issues two new tokens; the old
 * one is overwritten and instantly invalidated (Employee.inviteToken is
 * a single value, not an array). This is intentional: admin can click
 * "Regenerate" if they shared the old link in the wrong channel and want
 * to invalidate it.
 *
 * Returns nothing; redirects back to the edit page where the new token
 * is shown.
 */
export async function generatePairingLink(employeeId: string) {
  // Pairing-link generation/revocation modifies the employee's
  // inviteToken/lineUserId state — semantically an employee.update.
  const { user } = await requirePermission('employee.update');

  const emp = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      id: true,
      archivedAt: true,
      user: { select: { authUserId: true, lineUserId: true } },
    },
  });
  if (!emp) redirect('/admin/employees');
  if (emp.archivedAt) {
    redirect(
      `/admin/employees/${employeeId}/edit?error=${encodeURIComponent('พนักงานพ้นสภาพแล้ว ไม่สามารถสร้างลิงก์ใหม่ได้')}`,
    );
  }
  if (emp.user.lineUserId) {
    redirect(
      `/admin/employees/${employeeId}/edit?error=${encodeURIComponent('พนักงานนี้เชื่อม LINE แล้ว — ใช้ปุ่ม "ยกเลิกการเชื่อม" ก่อน')}`,
    );
  }

  const { token, expiresAt } = await mintPairingToken(employeeId);

  await prisma.employee.update({
    where: { id: employeeId },
    data: { inviteToken: token, inviteExpiresAt: expiresAt },
  });

  auditLog({
    actorId: user.id,
    action: 'employee.line-link',
    entityType: 'Employee',
    entityId: employeeId,
    after: { invited: true, expiresAt: expiresAt.toISOString() },
    metadata: { source: 'admin-ui', operation: 'mint-pairing-token' },
  });

  revalidatePath(`/admin/employees/${employeeId}/edit`);
  redirect(`/admin/employees/${employeeId}/edit#pairing`);
}

/**
 * Revoke any outstanding pairing link by clearing the token.
 * Doesn't affect an already-linked LINE account (separate flow).
 */
export async function revokePairingLink(employeeId: string) {
  // Pairing-link generation/revocation modifies the employee's
  // inviteToken/lineUserId state — semantically an employee.update.
  const { user } = await requirePermission('employee.update');

  const emp = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { inviteToken: true },
  });
  if (!emp?.inviteToken) redirect(`/admin/employees/${employeeId}/edit`);

  await prisma.employee.update({
    where: { id: employeeId },
    data: { inviteToken: null, inviteExpiresAt: null },
  });

  auditLog({
    actorId: user.id,
    action: 'employee.line-link',
    entityType: 'Employee',
    entityId: employeeId,
    after: { invited: false },
    metadata: { source: 'admin-ui', operation: 'revoke-pairing-token' },
  });

  revalidatePath(`/admin/employees/${employeeId}/edit`);
  redirect(`/admin/employees/${employeeId}/edit#pairing`);
}
