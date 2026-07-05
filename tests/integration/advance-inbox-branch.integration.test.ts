/**
 * End-to-end branch-scope harness for the cash-advance inbox read.
 *
 * Mirrors leave-inbox-branch: seeds a real multi-branch dataset + a real
 * branch-scoped admin in `koolman_test`, resolves permitted branches via the
 * REAL `getPermittedBranches`, and asserts `loadAdvanceInbox` (the exact read
 * `/admin/advance` runs) returns only in-scope rows — live (`prisma`) + trash
 * (`prismaRaw`) paths, and that a name search cannot escape the branch filter.
 */
import { Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadAdvanceInbox } from '@/app/(admin)/admin/advance/_load-inbox';
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

async function makeEmployee(opts: {
  branchId: string;
  assignedBranchIds?: string[];
  firstName?: string;
  nickname?: string;
}) {
  const user = await prisma.user.create({ data: {} });
  return prisma.employee.create({
    data: {
      userId: user.id,
      firstName: opts.firstName ?? 'Test',
      lastName: 'Worker',
      nickname: opts.nickname,
      branchId: opts.branchId,
      assignedBranchIds: opts.assignedBranchIds ?? [],
      salaryType: 'Monthly',
      baseSalary: new Prisma.Decimal(20_000),
      status: 'Active',
      hiredAt: new Date('2026-01-01'),
    },
  });
}

async function makePendingAdvance(employeeId: string, deletedAt?: Date) {
  return prisma.cashAdvance.create({
    data: {
      employeeId,
      amount: new Prisma.Decimal(1000),
      status: 'Pending',
      deletedAt: deletedAt ?? null,
    },
  });
}

/** An `advance.read` admin scoped to `branchId` (null ⇒ global). Returns permitted. */
async function scopedAdvanceAdmin(branchId: string | null) {
  const user = await prisma.user.create({ data: {} });
  const role = await prisma.roleDefinition.create({
    data: {
      key: `advance-reader-${uid().slice(0, 8)}`,
      name: 'Advance Reader',
      permissions: ['advance.read'],
      isSuperadmin: false,
      isSystem: false,
    },
  });
  await prisma.userRoleAssignment.create({ data: { userId: user.id, roleId: role.id, branchId } });
  return getPermittedBranches({ id: user.id }, 'advance.read');
}

beforeEach(resetDb);
afterAll(async () => {
  await prisma.$disconnect();
});

describe('advance inbox — branch-scoped read (integration)', () => {
  async function seedTwoBranches() {
    const [branchA, branchB] = await Promise.all([makeBranch('A'), makeBranch('B')]);
    const empA = await makeEmployee({ branchId: branchA.id, firstName: 'Alice', nickname: 'เอ' });
    const empB = await makeEmployee({ branchId: branchB.id, firstName: 'Bob', nickname: 'บี' });
    // Rotating staff: home in B, assigned to A → an A-scoped admin CAN see them.
    const empRot = await makeEmployee({
      branchId: branchB.id,
      assignedBranchIds: [branchA.id],
      firstName: 'Rota',
      nickname: 'โร',
    });
    return { branchA, branchB, empA, empB, empRot };
  }

  it('scoped admin (branch A) sees only A-branch + rotating-in advances, not B', async () => {
    const { branchA, empA, empB, empRot } = await seedTwoBranches();
    await Promise.all([
      makePendingAdvance(empA.id),
      makePendingAdvance(empB.id),
      makePendingAdvance(empRot.id),
    ]);

    const permitted = await scopedAdvanceAdmin(branchA.id);
    expect(permitted).toEqual([branchA.id]);

    const { rows, total } = await loadAdvanceInbox({
      permitted,
      isTrash: false,
      skip: 0,
      take: 50,
    });
    const ids = new Set(rows.map((r) => r.employeeId));
    expect(ids).toEqual(new Set([empA.id, empRot.id]));
    expect(ids.has(empB.id)).toBe(false);
    expect(total).toBe(2);
  });

  it("global admin ('all') sees every branch's advances", async () => {
    const { empA, empB, empRot } = await seedTwoBranches();
    await Promise.all([
      makePendingAdvance(empA.id),
      makePendingAdvance(empB.id),
      makePendingAdvance(empRot.id),
    ]);

    const permitted = await scopedAdvanceAdmin(null);
    expect(permitted).toBe('all');

    const { rows, total } = await loadAdvanceInbox({
      permitted,
      isTrash: false,
      skip: 0,
      take: 50,
    });
    expect(total).toBe(3);
    expect(new Set(rows.map((r) => r.employeeId))).toEqual(new Set([empA.id, empB.id, empRot.id]));
  });

  it('trash view (prismaRaw) is branch-scoped too — A-admin never sees B soft-deletes', async () => {
    const { branchA, empA, empB } = await seedTwoBranches();
    const now = new Date();
    await Promise.all([makePendingAdvance(empA.id, now), makePendingAdvance(empB.id, now)]);

    const permitted = await scopedAdvanceAdmin(branchA.id);
    const { rows, total } = await loadAdvanceInbox({ permitted, isTrash: true, skip: 0, take: 50 });
    expect(total).toBe(1);
    expect(rows.map((r) => r.employeeId)).toEqual([empA.id]);
  });

  it('a name search cannot escape the branch scope (search AND scope)', async () => {
    const { branchA, empA, empB } = await seedTwoBranches();
    await Promise.all([makePendingAdvance(empA.id), makePendingAdvance(empB.id)]);

    const permitted = await scopedAdvanceAdmin(branchA.id);
    const { rows, total } = await loadAdvanceInbox({
      permitted,
      q: 'Bob',
      isTrash: false,
      skip: 0,
      take: 50,
    });
    expect(total).toBe(0);
    expect(rows).toHaveLength(0);
  });
});
