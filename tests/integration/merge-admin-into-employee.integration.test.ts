import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mergeAdminIntoEmployee } from '@/lib/auth/merge-admin-into-employee';
import { prisma } from '@/lib/db/prisma';

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

async function seedPair() {
  const adminRole = await prisma.roleDefinition.findUniqueOrThrow({ where: { key: 'admin' } });
  const staffRole = await prisma.roleDefinition.findUniqueOrThrow({ where: { key: 'staff' } });
  const branch = await prisma.branch.create({ data: { name: 'B' } });
  // Ua: pure admin (email, no employee)
  const ua = await prisma.user.create({
    data: { email: 'boss@x.co', authUserId: crypto.randomUUID(), lineUserId: 'line-admin' },
  });
  await prisma.userRoleAssignment.create({
    data: { userId: ua.id, roleId: adminRole.id, branchId: null },
  });
  // Ue: worker (employee LINE)
  const ue = await prisma.user.create({
    data: { authUserId: crypto.randomUUID(), lineUserId: 'line-emp' },
  });
  await prisma.userRoleAssignment.create({
    data: { userId: ue.id, roleId: staffRole.id, branchId: null },
  });
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
    data: {
      employeeId: emp.id,
      date: new Date('2026-06-01'),
      type: 'Absent',
      source: 'Manual',
      createdById: ua.id,
    },
  });
  return { ua, ue, emp };
}

describe('mergeAdminIntoEmployee', () => {
  it('grants admin to the employee while keeping the admin account fully intact + audited', async () => {
    const { ua, ue, emp } = await seedPair();
    const res = await mergeAdminIntoEmployee({
      adminUserId: ua.id,
      employeeUserId: ue.id,
      lineUserId: 'line-emp',
    });
    expect(res.ok).toBe(true);

    // Employee gained admin (and kept staff).
    const ueRoles = await prisma.userRoleAssignment.findMany({
      where: { userId: ue.id },
      include: { role: true },
    });
    expect(ueRoles.map((r) => r.role.key).sort()).toEqual(['admin', 'staff']);

    // Attribution is NOT re-pointed — the admin's manual attendance stays theirs.
    const att = await prisma.attendance.findFirstOrThrow({ where: { employeeId: emp.id } });
    expect(att.createdById).toBe(ua.id);

    // The admin account is NEVER archived; email / auth / line stay intact, so
    // the admin can always still log in. It also keeps its own admin role.
    const adminAfter = await prisma.user.findUniqueOrThrow({ where: { id: ua.id } });
    expect(adminAfter.archivedAt).toBeNull();
    expect(adminAfter.email).toBe('boss@x.co');
    expect(adminAfter.authUserId).not.toBeNull();
    expect(adminAfter.lineUserId).toBe('line-admin');
    const uaRoles = await prisma.userRoleAssignment.findMany({ where: { userId: ua.id } });
    expect(uaRoles.length).toBe(1); // its admin assignment is untouched

    // The privilege grant is audited.
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'user.account-merge', entityId: ue.id },
    });
    expect(audit).not.toBeNull();
  });

  it('preserves headcount (exactly one Employee before and after)', async () => {
    const { ua, ue } = await seedPair();
    const before = await prisma.employee.count();
    await mergeAdminIntoEmployee({
      adminUserId: ua.id,
      employeeUserId: ue.id,
      lineUserId: 'line-emp',
    });
    const after = await prisma.employee.count();
    expect(after).toBe(before);
  });

  it('rejects when the employee user has no Employee record', async () => {
    const { ua } = await seedPair();
    const lonely = await prisma.user.create({ data: { lineUserId: 'line-x' } });
    const res = await mergeAdminIntoEmployee({
      adminUserId: ua.id,
      employeeUserId: lonely.id,
      lineUserId: 'line-x',
    });
    expect(res).toEqual({ ok: false, code: 'employee-no-record' });
  });
});

async function seedSelfPaired(opts: { adminLine: string | null; empLine: string | null }) {
  const adminRole = await prisma.roleDefinition.findUniqueOrThrow({ where: { key: 'admin' } });
  const staffRole = await prisma.roleDefinition.findUniqueOrThrow({ where: { key: 'staff' } });
  const branch = await prisma.branch.create({ data: { name: 'B2' } });
  const ua = await prisma.user.create({
    data: { email: 'boss2@x.co', authUserId: crypto.randomUUID(), lineUserId: opts.adminLine },
  });
  await prisma.userRoleAssignment.create({
    data: { userId: ua.id, roleId: adminRole.id, branchId: null },
  });
  const ue = await prisma.user.create({
    data: { authUserId: crypto.randomUUID(), lineUserId: opts.empLine },
  });
  await prisma.userRoleAssignment.create({
    data: { userId: ue.id, roleId: staffRole.id, branchId: null },
  });
  await prisma.employee.create({
    data: {
      userId: ue.id,
      firstName: 'C',
      lastName: 'D',
      branchId: branch.id,
      salaryType: 'Monthly',
      baseSalary: 20000,
      status: 'Active',
      hiredAt: new Date('2026-01-01'),
    },
  });
  return { ua, ue };
}

describe('mergeAdminIntoEmployee — LINE relocation', () => {
  it('relocates the LINE from a self-paired admin onto the employee row', async () => {
    const { ua, ue } = await seedSelfPaired({ adminLine: 'L', empLine: null });
    const res = await mergeAdminIntoEmployee({
      adminUserId: ua.id,
      employeeUserId: ue.id,
      lineUserId: 'L',
    });
    expect(res.ok).toBe(true);
    const uaAfter = await prisma.user.findUniqueOrThrow({ where: { id: ua.id } });
    const ueAfter = await prisma.user.findUniqueOrThrow({ where: { id: ue.id } });
    expect(ueAfter.lineUserId).toBe('L'); // LINE now on the employee row
    expect(uaAfter.lineUserId).toBeNull(); // removed from the admin row
    expect(uaAfter.email).toBe('boss2@x.co'); // email login preserved
    expect(uaAfter.archivedAt).toBeNull();
  });

  it('binds a fresh LINE to the employee row', async () => {
    const { ua, ue } = await seedSelfPaired({ adminLine: null, empLine: null });
    const res = await mergeAdminIntoEmployee({
      adminUserId: ua.id,
      employeeUserId: ue.id,
      lineUserId: 'L-fresh',
    });
    expect(res.ok).toBe(true);
    const ueAfter = await prisma.user.findUniqueOrThrow({ where: { id: ue.id } });
    expect(ueAfter.lineUserId).toBe('L-fresh');
  });

  it('refuses when the scanning LINE belongs to a third party', async () => {
    const { ua, ue } = await seedSelfPaired({ adminLine: null, empLine: null });
    await prisma.user.create({ data: { lineUserId: 'L-stranger' } });
    const res = await mergeAdminIntoEmployee({
      adminUserId: ua.id,
      employeeUserId: ue.id,
      lineUserId: 'L-stranger',
    });
    expect(res).toEqual({ ok: false, code: 'line-conflict' });
    const ueAfter = await prisma.user.findUniqueOrThrow({ where: { id: ue.id } });
    expect(ueAfter.lineUserId).toBeNull(); // no mutation
    const ueRoles = await prisma.userRoleAssignment.findMany({ where: { userId: ue.id } });
    expect(ueRoles.map((r) => r.roleId).length).toBe(1); // still only staff
  });

  it('leaves the LINE alone when the employee already holds it', async () => {
    const { ua, ue } = await seedSelfPaired({ adminLine: null, empLine: 'L-emp' });
    const res = await mergeAdminIntoEmployee({
      adminUserId: ua.id,
      employeeUserId: ue.id,
      lineUserId: 'L-emp',
    });
    expect(res.ok).toBe(true);
    const ueAfter = await prisma.user.findUniqueOrThrow({ where: { id: ue.id } });
    expect(ueAfter.lineUserId).toBe('L-emp');
  });
});
