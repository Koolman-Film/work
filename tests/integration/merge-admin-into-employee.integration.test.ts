import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { mergeAdminIntoEmployee } from '@/lib/auth/merge-admin-into-employee';

async function resetDb() {
  // Safe FK delete order: children before parents
  await prisma.attendance.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.userRoleAssignment.deleteMany({});
  await prisma.payroll.deleteMany({});
  await prisma.overtimeEntry.deleteMany({});
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

beforeEach(resetDb);
afterAll(async () => {
  await prisma.$disconnect();
});

async function seedPair() {
  const adminRole = await prisma.roleDefinition.findUniqueOrThrow({ where: { key: 'admin' } });
  const staffRole = await prisma.roleDefinition.findUniqueOrThrow({ where: { key: 'staff' } });
  const branch = await prisma.branch.create({ data: { name: 'B' } });
  // Ua: pure admin (email, no employee)
  const ua = await prisma.user.create({
    data: { email: 'boss@x.co', authUserId: crypto.randomUUID(), lineUserId: 'line-admin' },
  });
  await prisma.userRoleAssignment.create({ data: { userId: ua.id, roleId: adminRole.id, branchId: null } });
  // Ue: worker (employee LINE)
  const ue = await prisma.user.create({ data: { authUserId: crypto.randomUUID(), lineUserId: 'line-emp' } });
  await prisma.userRoleAssignment.create({ data: { userId: ue.id, roleId: staffRole.id, branchId: null } });
  const emp = await prisma.employee.create({
    data: {
      userId: ue.id,
      firstName: 'A',
      lastName: 'B',
      branchId: branch.id,
      salaryType: 'Monthly',
      baseSalary: 20000,
      status: 'Active',
      hiredAt: new Date('2026-01-01'),
    },
  });
  // An attendance the admin created manually (attribution points at Ua)
  await prisma.attendance.create({
    data: { employeeId: emp.id, date: new Date('2026-06-01'), type: 'Absent', source: 'Manual', createdById: ua.id },
  });
  return { ua, ue, emp };
}

describe('mergeAdminIntoEmployee', () => {
  it('moves admin role to the employee user, re-points attribution, archives the admin', async () => {
    const { ua, ue, emp } = await seedPair();
    const res = await mergeAdminIntoEmployee({ adminUserId: ua.id, employeeUserId: ue.id });
    expect(res.ok).toBe(true);

    const ueRoles = await prisma.userRoleAssignment.findMany({
      where: { userId: ue.id },
      include: { role: true },
    });
    expect(ueRoles.map((r) => r.role.key).sort()).toEqual(['admin', 'staff']);

    const att = await prisma.attendance.findFirstOrThrow({ where: { employeeId: emp.id } });
    expect(att.createdById).toBe(ue.id); // re-pointed

    const archivedUa = await prisma.user.findUniqueOrThrow({ where: { id: ua.id } });
    expect(archivedUa.archivedAt).not.toBeNull();
    expect(archivedUa.email).toBeNull();
    expect(archivedUa.lineUserId).toBeNull();
  });

  it('preserves headcount (exactly one Employee before and after)', async () => {
    const { ua, ue } = await seedPair();
    const before = await prisma.employee.count();
    await mergeAdminIntoEmployee({ adminUserId: ua.id, employeeUserId: ue.id });
    const after = await prisma.employee.count();
    expect(after).toBe(before);
  });

  it('rejects when the employee user has no Employee record', async () => {
    const { ua } = await seedPair();
    const lonely = await prisma.user.create({ data: { lineUserId: 'line-x' } });
    const res = await mergeAdminIntoEmployee({ adminUserId: ua.id, employeeUserId: lonely.id });
    expect(res).toEqual({ ok: false, code: 'employee-no-record' });
  });
});
