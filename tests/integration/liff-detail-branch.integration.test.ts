/**
 * End-to-end branch-scope harness for the LIFF admin detail-page reads.
 *
 * These use the existence-hide pattern — `findFirst({ id, ...scope })` → null
 * → notFound() — which is distinct from the list read-filters: it answers
 * "can a branch admin open an OUT-OF-BRANCH record by guessing its id?" (no).
 * Seeds a real multi-branch dataset + resolves permitted via the REAL
 * getPermittedBranches, then asserts in-scope ids return the row and
 * out-of-scope ids return null (and rotating-staff records are reachable).
 */
import { Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadLiffAdvanceDetail } from '@/app/(liff)/liff/admin/advance/[id]/_load';
import { loadLiffLeaveDetail } from '@/app/(liff)/liff/admin/leave/[id]/_load';
import { getPermittedBranches } from '@/lib/auth/branch-scope';
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

async function makeAdvance(employeeId: string) {
  return prisma.cashAdvance.create({
    data: { employeeId, amount: new Prisma.Decimal(1000), status: 'Pending' },
  });
}

async function makeLeave(employeeId: string, leaveTypeId: string) {
  return prisma.leaveRequest.create({
    data: {
      employeeId,
      leaveTypeId,
      startDate: new Date('2026-07-10'),
      endDate: new Date('2026-07-10'),
      reason: 'r',
      status: 'Pending',
    },
  });
}

async function scopedAdmin(branchId: string | null, perm: 'advance.read' | 'leave.read') {
  const user = await prisma.user.create({ data: {} });
  const role = await prisma.roleDefinition.create({
    data: {
      key: `liff-reader-${uid().slice(0, 8)}`,
      name: 'LIFF Reader',
      permissions: [perm],
      isSuperadmin: false,
      isSystem: false,
    },
  });
  await prisma.userRoleAssignment.create({ data: { userId: user.id, roleId: role.id, branchId } });
  return getPermittedBranches({ id: user.id }, perm);
}

beforeEach(resetDb);
afterAll(async () => {
  await prisma.$disconnect();
});

describe('LIFF admin detail reads — branch-scoped existence-hide (integration)', () => {
  async function seed() {
    const [branchA, branchB] = await Promise.all([makeBranch('A'), makeBranch('B')]);
    const lt = await prisma.leaveType.create({
      data: { name: `ลากิจ-${uid().slice(0, 8)}`, overQuotaPolicy: 'DeductPay', annualQuota: 5 },
    });
    const empA = await makeEmployee({ branchId: branchA.id });
    const empB = await makeEmployee({ branchId: branchB.id });
    const empRot = await makeEmployee({ branchId: branchB.id, assignedBranchIds: [branchA.id] });
    return { branchA, lt, empA, empB, empRot };
  }

  it('advance/[id]: A-admin gets in-scope + rotating rows, null for out-of-branch id', async () => {
    const { branchA, empA, empB, empRot } = await seed();
    const advA = await makeAdvance(empA.id);
    const advB = await makeAdvance(empB.id);
    const advRot = await makeAdvance(empRot.id);

    const permitted = await scopedAdmin(branchA.id, 'advance.read');
    expect(permitted).toEqual([branchA.id]);

    expect(await loadLiffAdvanceDetail(advA.id, permitted)).not.toBeNull();
    expect(await loadLiffAdvanceDetail(advRot.id, permitted)).not.toBeNull();
    // Out-of-branch id → null (the page turns this into notFound()).
    expect(await loadLiffAdvanceDetail(advB.id, permitted)).toBeNull();
  });

  it('leave/[id]: A-admin gets in-scope row, null for out-of-branch id', async () => {
    const { branchA, lt, empA, empB } = await seed();
    const leaveA = await makeLeave(empA.id, lt.id);
    const leaveB = await makeLeave(empB.id, lt.id);

    const permitted = await scopedAdmin(branchA.id, 'leave.read');
    expect(await loadLiffLeaveDetail(leaveA.id, permitted)).not.toBeNull();
    expect(await loadLiffLeaveDetail(leaveB.id, permitted)).toBeNull();
  });

  it("global admin ('all') can open any branch's record by id", async () => {
    const { lt, empB } = await seed();
    const advB = await makeAdvance(empB.id);
    const leaveB = await makeLeave(empB.id, lt.id);

    const advPermitted = await scopedAdmin(null, 'advance.read');
    const leavePermitted = await scopedAdmin(null, 'leave.read');
    expect(advPermitted).toBe('all');
    expect(await loadLiffAdvanceDetail(advB.id, advPermitted)).not.toBeNull();
    expect(await loadLiffLeaveDetail(leaveB.id, leavePermitted)).not.toBeNull();
  });
});
