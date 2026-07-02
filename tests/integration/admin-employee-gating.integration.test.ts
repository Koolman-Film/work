import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { computeTier } from '@/lib/auth/user-tier';
import { prisma } from '@/lib/db/prisma';

async function resetDb() {
  await prisma.userRoleAssignment.deleteMany({});
  await prisma.payroll.deleteMany({});
  await prisma.overtimeEntry.deleteMany({});
  await prisma.attendance.deleteMany({});
  await prisma.cashAdvance.deleteMany({});
  await prisma.recurringDeduction.deleteMany({});
  await prisma.leaveRequest.deleteMany({});
  await prisma.employee.deleteMany({});
  await prisma.workSchedule.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.leaveType.deleteMany({});
  await prisma.branch.deleteMany({});
  await prisma.payrollConfig.deleteMany({});
  await prisma.roleDefinition.deleteMany({});
  await prisma.roleDefinition.create({
    data: {
      key: 'admin',
      name: 'Admin',
      permissions: ['liff.admin'],
      isSuperadmin: false,
      isSystem: true,
    },
  });
  await prisma.roleDefinition.create({
    data: { key: 'staff', name: 'Staff', permissions: [], isSuperadmin: false, isSystem: true },
  });
}

beforeEach(resetDb);
afterAll(async () => {
  await prisma.$disconnect();
});

describe('admin-employee gating invariants', () => {
  it('an employee granted admin is tier Admin yet still has an Employee record', async () => {
    const user = await prisma.user.create({ data: {} });
    const branch = await prisma.branch.create({ data: { name: 'B' } });
    const staff = await prisma.roleDefinition.findUniqueOrThrow({ where: { key: 'staff' } });
    await prisma.userRoleAssignment.create({
      data: { userId: user.id, roleId: staff.id, branchId: null },
    });
    await prisma.employee.create({
      data: {
        userId: user.id,
        firstName: 'A',
        lastName: 'B',
        branchId: branch.id,
        salaryType: 'Monthly',
        baseSalary: 20000,
        status: 'Active',
        hiredAt: new Date('2026-01-01'),
      },
    });

    // Grant admin the way the merge flow does: a global 'admin' assignment
    // on the employee's User (the employee-edit grant button was removed).
    const admin = await prisma.roleDefinition.findUniqueOrThrow({ where: { key: 'admin' } });
    await prisma.userRoleAssignment.create({
      data: { userId: user.id, roleId: admin.id, branchId: null },
    });

    const reloaded = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { employee: true, roleAssignments: { include: { role: true } } },
    });
    const tier = computeTier(
      reloaded.roleAssignments.map((a) => ({
        role: { key: a.role.key, isSuperadmin: a.role.isSuperadmin, archivedAt: a.role.archivedAt },
      })),
    );
    expect(tier).toBe('Admin'); // masked — would fail the old Staff gate
    expect(reloaded.employee).not.toBeNull(); // but the source-of-truth gate passes
  });
});
