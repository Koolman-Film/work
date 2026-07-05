/**
 * End-to-end branch-scope harness for the dashboard widget reads.
 *
 * Seeds a real multi-branch dataset + a real branch-scoped admin in
 * `koolman_test` and asserts `loadDashboardStats` (the exact scoped reads
 * `/admin` runs) filters every widget to the actor's branches. Covers all four
 * scope fragments the loader builds: leave (`leave.read`), advance
 * (`advance.read`), attendance-via-employee and roster-direct (`attendance.read`).
 */
import { Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadDashboardStats } from '@/app/(admin)/admin/_load-dashboard-stats';
import { getUserAssignments } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';

const uid = () => crypto.randomUUID();
const TODAY = new Date(Date.UTC(2026, 6, 15));

async function resetDb() {
  await prisma.userRoleAssignment.deleteMany({});
  await prisma.payroll.deleteMany({});
  await prisma.overtimeEntry.deleteMany({});
  await prisma.attendance.deleteMany({});
  await prisma.cashAdvance.deleteMany({});
  await prisma.recurringDeduction.deleteMany({});
  await prisma.leaveRequest.deleteMany({});
  await prisma.leaveType.deleteMany({});
  await prisma.employee.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.branch.deleteMany({});
  await prisma.roleDefinition.deleteMany({});
}

async function makeBranch(name: string) {
  return prisma.branch.create({ data: { name: `${name}-${uid().slice(0, 8)}` } });
}

async function makeEmployee(opts: { branchId: string; assignedBranchIds?: string[] }) {
  const user = await prisma.user.create({ data: {} });
  return prisma.employee.create({
    data: {
      userId: user.id,
      firstName: 'Test',
      lastName: 'Worker',
      branchId: opts.branchId,
      assignedBranchIds: opts.assignedBranchIds ?? [],
      salaryType: 'Monthly',
      baseSalary: new Prisma.Decimal(20_000),
      status: 'Active',
      hiredAt: new Date('2026-01-01'),
    },
  });
}

async function seedEmployeeActivity(emp: { id: string; userId: string }, leaveTypeId: string) {
  await prisma.leaveRequest.create({
    data: {
      employeeId: emp.id,
      leaveTypeId,
      startDate: TODAY,
      endDate: TODAY,
      reason: 'r',
      status: 'Pending',
    },
  });
  await prisma.cashAdvance.create({
    data: { employeeId: emp.id, amount: new Prisma.Decimal(1000), status: 'Pending' },
  });
  await prisma.attendance.create({
    data: {
      employeeId: emp.id,
      date: TODAY,
      type: 'CheckIn',
      source: 'Liff',
      clockInAt: new Date('2026-07-15T02:00:00.000Z'),
      createdById: emp.userId,
    },
  });
}

/** An admin scoped to `branchId` (null ⇒ global) holding all three read perms. */
async function scopedDashboardAdmin(branchId: string | null) {
  const user = await prisma.user.create({ data: {} });
  const role = await prisma.roleDefinition.create({
    data: {
      key: `dash-reader-${uid().slice(0, 8)}`,
      name: 'Dashboard Reader',
      permissions: ['leave.read', 'advance.read', 'attendance.read'],
      isSuperadmin: false,
      isSystem: false,
    },
  });
  await prisma.userRoleAssignment.create({ data: { userId: user.id, roleId: role.id, branchId } });
  return getUserAssignments(user.id);
}

beforeEach(resetDb);
afterAll(async () => {
  await prisma.$disconnect();
});

describe('dashboard stats — branch-scoped reads (integration)', () => {
  async function seed() {
    const [branchA, branchB] = await Promise.all([makeBranch('A'), makeBranch('B')]);
    const lt = await prisma.leaveType.create({
      data: { name: `ลากิจ-${uid().slice(0, 8)}`, overQuotaPolicy: 'DeductPay', annualQuota: 5 },
    });
    const empA = await makeEmployee({ branchId: branchA.id });
    const empB = await makeEmployee({ branchId: branchB.id });
    const empRot = await makeEmployee({ branchId: branchB.id, assignedBranchIds: [branchA.id] });
    await seedEmployeeActivity(empA, lt.id);
    await seedEmployeeActivity(empB, lt.id);
    await seedEmployeeActivity(empRot, lt.id);
    return { branchA, empA, empB, empRot };
  }

  it('scoped admin (branch A) sees only A-branch + rotating-in widgets, not B', async () => {
    const { branchA, empA, empB, empRot } = await seed();
    const assignments = await scopedDashboardAdmin(branchA.id);

    const stats = await loadDashboardStats({ assignments, today: TODAY });

    expect(stats.pendingLeaveCount).toBe(2); // A + Rot, not B
    expect(stats.pendingAdvanceCount).toBe(2);
    expect(new Set(stats.checkedInTodayRows.map((r) => r.employeeId))).toEqual(
      new Set([empA.id, empRot.id]),
    );
    expect(new Set(stats.activeEmployees.map((e) => e.id))).toEqual(new Set([empA.id, empRot.id]));
    expect(stats.checkedInTodayRows.some((r) => r.employeeId === empB.id)).toBe(false);
  });

  it("global admin ('all') sees every branch's widgets", async () => {
    const { empA, empB, empRot } = await seed();
    const assignments = await scopedDashboardAdmin(null);

    const stats = await loadDashboardStats({ assignments, today: TODAY });

    expect(stats.pendingLeaveCount).toBe(3);
    expect(stats.pendingAdvanceCount).toBe(3);
    expect(new Set(stats.checkedInTodayRows.map((r) => r.employeeId))).toEqual(
      new Set([empA.id, empB.id, empRot.id]),
    );
    expect(new Set(stats.activeEmployees.map((e) => e.id))).toEqual(
      new Set([empA.id, empB.id, empRot.id]),
    );
  });
});
