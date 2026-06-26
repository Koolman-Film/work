import { prisma } from '@/lib/db/prisma';

type Result =
  | { ok: true }
  | { ok: false; code: 'same-user' | 'admin-not-pure' | 'employee-no-record' | 'not-found' };

/**
 * Collapse a legacy two-account admin-employee into ONE User. Keeps the
 * employee User (all Employee-FK'd data stays put); copies the admin role,
 * re-points attribution + notifications from the admin User, then archives it.
 * Value-preserving: never edits Employee/attendance/leave/advance VALUES.
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
    for (const a of adminRoles) {
      const exists = await tx.userRoleAssignment.findFirst({
        where: { userId: employeeUserId, roleId: a.roleId, branchId: a.branchId },
      });
      if (!exists) {
        await tx.userRoleAssignment.create({
          data: { userId: employeeUserId, roleId: a.roleId, branchId: a.branchId },
        });
      }
    }
    // 2. Re-point admin attribution (unconstrained UUID columns) + notifications.
    await tx.attendance.updateMany({
      where: { createdById: adminUserId },
      data: { createdById: employeeUserId },
    });
    await tx.leaveRequest.updateMany({
      where: { reviewedById: adminUserId },
      data: { reviewedById: employeeUserId },
    });
    await tx.cashAdvance.updateMany({
      where: { approvedById: adminUserId },
      data: { approvedById: employeeUserId },
    });
    await tx.overtimeEntry.updateMany({
      where: { reviewedById: adminUserId },
      data: { reviewedById: employeeUserId },
    });
    await tx.overtimeEntry.updateMany({
      where: { createdById: adminUserId },
      data: { createdById: employeeUserId },
    });
    await tx.notification.updateMany({
      where: { userId: adminUserId },
      data: { userId: employeeUserId },
    });
    // 3. Retire the admin User: remove its assignments, archive, free uniques.
    await tx.userRoleAssignment.deleteMany({ where: { userId: adminUserId } });
    await tx.user.update({
      where: { id: adminUserId },
      data: {
        archivedAt: new Date(),
        email: null,
        authUserId: null,
        lineUserId: null,
        lineInviteToken: null,
        mergeToken: null,
        mergeTokenExpiresAt: null,
      },
    });
  });

  return { ok: true };
}
