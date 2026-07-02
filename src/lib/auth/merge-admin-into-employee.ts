import { auditLogTx } from '@/lib/audit/log';
import { prisma } from '@/lib/db/prisma';
import { syncRichMenuForUser } from '@/lib/line/rich-menu';

type Result =
  | { ok: true }
  | {
      ok: false;
      code:
        | 'same-user'
        | 'admin-not-pure'
        | 'employee-no-record'
        | 'employee-archived'
        | 'not-found'
        | 'line-conflict';
    };

/**
 * Grant a pure-admin account's admin access to an employee account, so the
 * employee's LINE login can also reach the admin tools.
 *
 * NON-DESTRUCTIVE (reworked 2026-06-26 after an incident where a mis-scanned
 * merge QR archived a real admin and handed their Superadmin to a stranger):
 * the admin account is NEVER archived and its email / authUserId are NEVER
 * cleared — the admin can always still log in with their email. This function
 * only:
 *   1. copies the admin's admin/superadmin role assignments onto the employee,
 *   2. enforces the invariant that the LINE binding lives on the employee row
 *      (binds if fresh, relocates from the admin row if self-paired, refuses
 *      if the LINE already belongs to a third party),
 *   3. consumes the single-use merge token on the admin row, and
 *   4. writes an audit row (including the LINE action taken).
 * It does NOT re-point attribution (the admin stays alive, so its history stays
 * correctly attributed to it). The grant is fully reversible — remove the copied
 * role assignments from the employee.
 */
export async function mergeAdminIntoEmployee(input: {
  adminUserId: string;
  employeeUserId: string;
  lineUserId: string;
}): Promise<Result> {
  const { adminUserId, employeeUserId, lineUserId } = input;
  if (adminUserId === employeeUserId) return { ok: false, code: 'same-user' };

  const [admin, employeeUser, lineOwner] = await Promise.all([
    prisma.user.findUnique({
      where: { id: adminUserId },
      include: { employee: { select: { id: true } }, roleAssignments: { include: { role: true } } },
    }),
    prisma.user.findUnique({
      where: { id: employeeUserId },
      include: { employee: { select: { id: true, archivedAt: true } } },
    }),
    prisma.user.findUnique({ where: { lineUserId }, select: { id: true } }),
  ]);
  if (!admin || !employeeUser) return { ok: false, code: 'not-found' };
  if (admin.employee !== null) return { ok: false, code: 'admin-not-pure' };
  if (employeeUser.employee === null) return { ok: false, code: 'employee-no-record' };
  // Don't grant admin onto an archived/departed employee. The picker filters to
  // Active at mint time, but the token lives 1h — the employee could be archived
  // in the gap (either the User row or the Employee row).
  if (employeeUser.archivedAt !== null || employeeUser.employee.archivedAt !== null) {
    return { ok: false, code: 'employee-archived' };
  }

  // The scanning LINE must be unbound, or belong to the admin or the employee of
  // this pair. Bound to anyone else → a different human; refuse, mutate nothing.
  if (lineOwner && lineOwner.id !== adminUserId && lineOwner.id !== employeeUserId) {
    return { ok: false, code: 'line-conflict' };
  }

  // Only copy admin/superadmin roles — custom or staff roles on the admin
  // user are intentionally not carried over to the employee account. Skip
  // assignments to an archived role definition (matches computeTier, which
  // ignores archived roles) so a retired role never propagates as live.
  const adminRoles = admin.roleAssignments.filter(
    (a) => (a.role.key === 'admin' || a.role.isSuperadmin) && a.role.archivedAt === null,
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

    // 2. Enforce the invariant: the LINE binding lives on the employee row.
    //    Skip if the employee already holds its own LINE. We move at most one
    //    `lineUserId` column — never touch email/authUserId (non-destructive).
    let lineAction: 'none' | 'bound' | 'relocated' = 'none';
    if (employeeUser.lineUserId === null) {
      if (lineOwner?.id === adminUserId) {
        // Self-paired admin: clear the admin's LINE first (unique), then set it
        // on the employee row.
        await tx.user.update({ where: { id: adminUserId }, data: { lineUserId: null } });
        await tx.user.update({ where: { id: employeeUserId }, data: { lineUserId } });
        lineAction = 'relocated';
      } else if (lineOwner === null) {
        // Fresh LINE: bind it to the employee row.
        await tx.user.update({ where: { id: employeeUserId }, data: { lineUserId } });
        lineAction = 'bound';
      }
    }

    // 3. Consume the single-use merge token on the admin row. We deliberately do
    //    NOT archive the admin, clear its email/authUserId, or re-point
    //    attribution — the admin account stays fully usable.
    await tx.user.update({
      where: { id: adminUserId },
      data: { mergeToken: null, mergeTokenExpiresAt: null },
    });

    // 4. Audit the privilege grant + any LINE move (the security-sensitive bits).
    await auditLogTx(tx, {
      actorId: adminUserId,
      action: 'user.account-merge',
      entityType: 'User',
      entityId: employeeUserId,
      after: { grantedRoles: granted, fromAdminUserId: adminUserId, lineAction, lineUserId },
      metadata: { adminUserId, employeeUserId },
    });
  });

  // The surviving employee user now also holds the admin role → combined menu.
  // Best-effort; never throws.
  await syncRichMenuForUser(employeeUserId);

  return { ok: true };
}
