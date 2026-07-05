/**
 * End-to-end branch-scope harness for the sidebar badge counts.
 *
 * Seeds a real multi-branch dataset + a real branch-scoped admin in
 * `koolman_test` and asserts `loadSidebarBadgeCounts` (the exact counts
 * `(admin)/layout.tsx` runs) filters each per-domain count to the actor's
 * branches — so a branch admin never sees cross-branch pending volume.
 */
import { Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadSidebarBadgeCounts } from '@/app/(admin)/_load-badge-counts';
import { getUserAssignments } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';

const uid = () => crypto.randomUUID();

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

let dayCounter = 1;
/** One Pending leave, one Pending advance, one Disputed check-in — the three
 *  things the badges count. */
async function seedBadgeWork(emp: { id: string; userId: string }, leaveTypeId: string) {
  const d = new Date(Date.UTC(2026, 6, dayCounter++));
  await prisma.leaveRequest.create({
    data: {
      employeeId: emp.id,
      leaveTypeId,
      startDate: d,
      endDate: d,
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
      date: d,
      type: 'CheckIn',
      source: 'Liff',
      checkInStatus: 'Disputed',
      createdById: emp.userId,
    },
  });
}

async function scopedAdmin(branchId: string | null) {
  const user = await prisma.user.create({ data: {} });
  const role = await prisma.roleDefinition.create({
    data: {
      key: `badge-reader-${uid().slice(0, 8)}`,
      name: 'Badge Reader',
      permissions: ['leave.read', 'advance.read', 'attendance.read'],
      isSuperadmin: false,
      isSystem: false,
    },
  });
  await prisma.userRoleAssignment.create({ data: { userId: user.id, roleId: role.id, branchId } });
  return getUserAssignments(user.id);
}

beforeEach(async () => {
  await resetDb();
  dayCounter = 1;
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('sidebar badge counts — branch-scoped (integration)', () => {
  async function seed() {
    const [branchA, branchB] = await Promise.all([makeBranch('A'), makeBranch('B')]);
    const lt = await prisma.leaveType.create({
      data: { name: `ลากิจ-${uid().slice(0, 8)}`, overQuotaPolicy: 'DeductPay', annualQuota: 5 },
    });
    const empA = await makeEmployee({ branchId: branchA.id });
    const empB = await makeEmployee({ branchId: branchB.id });
    const empRot = await makeEmployee({ branchId: branchB.id, assignedBranchIds: [branchA.id] });
    await seedBadgeWork(empA, lt.id);
    await seedBadgeWork(empB, lt.id);
    await seedBadgeWork(empRot, lt.id);
    return { branchA };
  }

  it('scoped admin (branch A) counts only A-branch + rotating-in work', async () => {
    const { branchA } = await seed();
    const assignments = await scopedAdmin(branchA.id);
    const counts = await loadSidebarBadgeCounts(assignments);
    expect(counts).toEqual({ leave: 2, advance: 2, attendance: 2 }); // A + Rot, not B
  });

  it("global admin ('all') counts every branch's work", async () => {
    await seed();
    const assignments = await scopedAdmin(null);
    const counts = await loadSidebarBadgeCounts(assignments);
    expect(counts).toEqual({ leave: 3, advance: 3, attendance: 3 });
  });
});
