import { auditLogTx } from '@/lib/audit/log';
import { prisma } from '@/lib/db/prisma';

type Result =
  | { ok: true }
  | { ok: false; code: 'same-user' | 'admin-not-pure' | 'employee-no-record' | 'not-found' };

/**
 * Grant a pure-admin account's admin access to an employee account, so the
 * employee's LINE login can also reach the admin tools.
 *
 * NON-DESTRUCTIVE (reworked 2026-06-26 after an incident where a mis-scanned
 * merge QR archived a real admin and handed their Superadmin to a stranger):
 * the admin account is NEVER archived and its email / authUserId / lineUserId
 * are NEVER cleared — the admin can always still log in with their email. This
 * function only:
 *   1. copies the admin's admin/superadmin role assignments onto the employee,
 *   2. consumes the single-use merge token on the admin row, and
 *   3. writes an audit row.
 * It does NOT re-point attribution (the admin stays alive, so its history stays
 * correctly attributed to it). The grant is fully reversible — remove the copied
 * role assignments from the employee.
 */
export async function mergeAdminIntoEmployee(input: {
  adminUserId: string;
  employeeUserId: string;
}): Promise<Result> {
  const { adminUserId, employeeUserId } = input;
  if (adminUserId === employeeUserId) return { ok: false, code: 'same-user' };

  const [admin, employeeUser] = await Promise.all([
    prisma.user.findUnique({
      where: { id: adminUserId },
      include: { employee: { select: { id: true } }, roleAssignments: { include: { role: true } } },
    }),
    prisma.user.findUnique({
      where: { id: employeeUserId },
      include: { employee: { select: { id: true } } },
    }),
  ]);
  if (!admin || !employeeUser) return { ok: false, code: 'not-found' };
  if (admin.employee !== null) return { ok: false, code: 'admin-not-pure' };
  if (employeeUser.employee === null) return { ok: false, code: 'employee-no-record' };

  // Only copy admin/superadmin roles — custom or staff roles on the admin
  // user are intentionally not carried over to the employee account.
  const adminRoles = admin.roleAssignments.filter(
    (a) => a.role.key === 'admin' || a.role.isSuperadmin,
  );

  await prisma.$transaction(async (tx) => {
    // 1. Copy admin role assignments onto the employee user (dedupe; NULL
    //    branch can't use compound-unique upsert — guard with findFirst).
    const granted: string[] = [];
    for (const a of adminRoles) {
      const exists = await tx.userRoleAssignment.findFirst({
        where: { userId: employeeUserId, roleId: a.roleId, branchId: a.branchId },
      });
      if (!exists) {
        await tx.userRoleAssignment.create({
          data: { userId: employeeUserId, roleId: a.roleId, branchId: a.branchId },
        });
        granted.push(a.role.key);
      }
    }

    // 2. Consume the single-use merge token on the admin row. We deliberately do
    //    NOT archive the admin, clear its email/authUserId/lineUserId, or
    //    re-point attribution — the admin account stays fully usable.
    await tx.user.update({
      where: { id: adminUserId },
      data: { mergeToken: null, mergeTokenExpiresAt: null },
    });

    // 3. Audit the privilege grant (the most security-sensitive action here).
    await auditLogTx(tx, {
      actorId: adminUserId,
      action: 'user.account-merge',
      entityType: 'User',
      entityId: employeeUserId,
      after: { grantedRoles: granted, fromAdminUserId: adminUserId },
      metadata: { adminUserId, employeeUserId },
    });
  });

  return { ok: true };
}
