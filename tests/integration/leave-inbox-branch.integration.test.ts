/**
 * End-to-end branch-scope harness for the leave inbox read.
 *
 * Unlike the helper unit tests (which drive the scope primitives with mocked
 * Prisma), this seeds a real multi-branch dataset + a branch-scoped admin in
 * the dedicated `koolman_test` DB, resolves the actor's permitted branches via
 * the REAL `getPermittedBranches`, and asserts `loadLeaveInbox` (the exact read
 * the `/admin/leave` page runs) returns only in-scope rows — on both the live
 * (`prisma`) and trash (`prismaRaw`) paths, and that a name search cannot escape
 * the branch filter. This is the vertical-slice template for extending the
 * harness to the advance / attendance / dashboard read-filters.
 */
import { Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadLeaveInbox } from '@/app/(admin)/admin/leave/_load-inbox';
import { getPermittedBranches } from '@/lib/auth/branch-scope';
import { prisma } from '@/lib/db/prisma';

const uid = () => crypto.randomUUID();

async function resetDb() {
  // Delete in FK-safe order; mirror other integration resets so leftover rows
  // from another file can't block employee/branch deletes.
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
  lastName?: string;
  nickname?: string;
}) {
  const user = await prisma.user.create({ data: {} });
  return prisma.employee.create({
    data: {
      userId: user.id,
      firstName: opts.firstName ?? 'Test',
      lastName: opts.lastName ?? 'Worker',
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

async function makePendingLeave(employeeId: string, leaveTypeId: string, deletedAt?: Date) {
  return prisma.leaveRequest.create({
    data: {
      employeeId,
      leaveTypeId,
      startDate: new Date('2026-07-10'),
      endDate: new Date('2026-07-10'),
      reason: 'r',
      status: 'Pending',
      deletedAt: deletedAt ?? null,
    },
  });
}

/** A `leave.read` admin scoped to `branchId` (null ⇒ global). Returns permitted. */
async function scopedLeaveAdmin(branchId: string | null) {
  const user = await prisma.user.create({ data: {} });
  const role = await prisma.roleDefinition.create({
    data: {
      key: `leave-reader-${uid().slice(0, 8)}`,
      name: 'Leave Reader',
      permissions: ['leave.read'],
      isSuperadmin: false,
      isSystem: false,
    },
  });
  await prisma.userRoleAssignment.create({ data: { userId: user.id, roleId: role.id, branchId } });
  return getPermittedBranches({ id: user.id }, 'leave.read');
}

beforeEach(resetDb);
afterAll(async () => {
  await prisma.$disconnect();
});

describe('leave inbox — branch-scoped read (integration)', () => {
  async function seedTwoBranches() {
    const [branchA, branchB] = await Promise.all([makeBranch('A'), makeBranch('B')]);
    const lt = await prisma.leaveType.create({
      data: { name: `ลากิจ-${uid().slice(0, 8)}`, overQuotaPolicy: 'DeductPay', annualQuota: 5 },
    });
    const empA = await makeEmployee({ branchId: branchA.id, firstName: 'Alice', nickname: 'เอ' });
    const empB = await makeEmployee({ branchId: branchB.id, firstName: 'Bob', nickname: 'บี' });
    // Rotating staff: home in B, assigned to A → an A-scoped admin CAN see them.
    const empRot = await makeEmployee({
      branchId: branchB.id,
      assignedBranchIds: [branchA.id],
      firstName: 'Rota',
      nickname: 'โร',
    });
    return { branchA, branchB, lt, empA, empB, empRot };
  }

  it('scoped admin (branch A) sees only A-branch + rotating-in leave, not B', async () => {
    const { branchA, lt, empA, empB, empRot } = await seedTwoBranches();
    await Promise.all([
      makePendingLeave(empA.id, lt.id),
      makePendingLeave(empB.id, lt.id),
      makePendingLeave(empRot.id, lt.id),
    ]);

    const permitted = await scopedLeaveAdmin(branchA.id);
    expect(permitted).toEqual([branchA.id]);

    const { rows, total } = await loadLeaveInbox({
      permitted,
      isTrash: false,
      skip: 0,
      take: 50,
    });
    const ids = new Set(rows.map((r) => r.employeeId));
    expect(ids).toEqual(new Set([empA.id, empRot.id]));
    expect(ids.has(empB.id)).toBe(false);
    expect(total).toBe(2); // count mirrors findMany's scoped where
  });

  it("global admin ('all') sees every branch's leave", async () => {
    const { lt, empA, empB, empRot } = await seedTwoBranches();
    await Promise.all([
      makePendingLeave(empA.id, lt.id),
      makePendingLeave(empB.id, lt.id),
      makePendingLeave(empRot.id, lt.id),
    ]);

    const permitted = await scopedLeaveAdmin(null);
    expect(permitted).toBe('all');

    const { rows, total } = await loadLeaveInbox({ permitted, isTrash: false, skip: 0, take: 50 });
    expect(total).toBe(3);
    expect(new Set(rows.map((r) => r.employeeId))).toEqual(new Set([empA.id, empB.id, empRot.id]));
  });

  it('trash view (prismaRaw) is branch-scoped too — A-admin never sees B soft-deletes', async () => {
    const { branchA, lt, empA, empB } = await seedTwoBranches();
    const now = new Date();
    await Promise.all([
      makePendingLeave(empA.id, lt.id, now), // soft-deleted A leave
      makePendingLeave(empB.id, lt.id, now), // soft-deleted B leave
    ]);

    const permitted = await scopedLeaveAdmin(branchA.id);
    const { rows, total } = await loadLeaveInbox({ permitted, isTrash: true, skip: 0, take: 50 });
    expect(total).toBe(1);
    expect(rows.map((r) => r.employeeId)).toEqual([empA.id]);
  });

  it('a name search cannot escape the branch scope (search AND scope)', async () => {
    const { branchA, lt, empA, empB } = await seedTwoBranches();
    await Promise.all([makePendingLeave(empA.id, lt.id), makePendingLeave(empB.id, lt.id)]);

    const permitted = await scopedLeaveAdmin(branchA.id);
    // Search for the OUT-OF-SCOPE employee's name — scope must still exclude them.
    const { rows, total } = await loadLeaveInbox({
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
