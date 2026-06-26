import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { assignAdminRole } from '@/lib/employee/assign-admin-role';

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
    data: { key: 'admin', name: 'Admin', permissions: ['liff.admin'], isSuperadmin: false, isSystem: true },
  });
  await prisma.roleDefinition.create({
    data: { key: 'staff', name: 'Staff', permissions: [], isSuperadmin: false, isSystem: true },
  });
}

async function makeWorker() {
  const user = await prisma.user.create({ data: {} });
  const branch = await prisma.branch.create({ data: { name: 'B' } });
  const staff = await prisma.roleDefinition.findUniqueOrThrow({ where: { key: 'staff' } });
  await prisma.userRoleAssignment.create({ data: { userId: user.id, roleId: staff.id, branchId: null } });
  const emp = await prisma.employee.create({
    data: {
      userId: user.id, firstName: 'A', lastName: 'B', branchId: branch.id,
      salaryType: 'Monthly', baseSalary: 20000, status: 'Active', hiredAt: new Date('2026-01-01'),
    },
  });
  return { user, emp };
}

beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); });

describe('assignAdminRole', () => {
  it('adds a global admin assignment to the employee user', async () => {
    const { user, emp } = await makeWorker();
    await assignAdminRole(emp.id);
    const assignments = await prisma.userRoleAssignment.findMany({
      where: { userId: user.id }, include: { role: true },
    });
    const keys = assignments.map((a) => a.role.key).sort();
    expect(keys).toEqual(['admin', 'staff']);
  });

  it('is idempotent (no duplicate admin assignment)', async () => {
    const { user, emp } = await makeWorker();
    await assignAdminRole(emp.id);
    await assignAdminRole(emp.id);
    const count = await prisma.userRoleAssignment.count({
      where: { userId: user.id, role: { key: 'admin' } },
    });
    expect(count).toBe(1);
  });
});
