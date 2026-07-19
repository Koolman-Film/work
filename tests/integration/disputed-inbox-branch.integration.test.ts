/**
 * End-to-end branch-scope harness for the disputed-check-in inbox read.
 *
 * Mirrors the leave/advance slices: seeds a real multi-branch dataset + a real
 * branch-scoped admin in `koolman_test`, resolves permitted branches via the
 * REAL `getPermittedBranches`, and asserts `loadDisputedCheckIns` (the exact
 * read `/admin/attendance/disputed` runs) returns only in-scope rows. Also
 * confirms the Disputed-only status filter survives the extraction.
 */
import { Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadDisputedCheckIns } from '@/app/(admin)/admin/attendance/disputed/_load-inbox';
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

let dayCounter = 1;
async function makeCheckIn(emp: { id: string; userId: string }, status: 'Disputed' | 'Confirmed') {
  // Distinct dates avoid any (employee, date, type) collisions across rows.
  const d = new Date(Date.UTC(2026, 6, dayCounter++));
  return prisma.attendance.create({
    data: {
      employeeId: emp.id,
      date: d,
      type: 'CheckIn',
      source: 'Liff',
      checkInStatus: status,
      clockInAt: new Date(`${d.toISOString().slice(0, 10)}T02:00:00.000Z`),
      createdById: emp.userId,
    },
  });
}

async function scopedAttendanceAdmin(branchId: string | null) {
  const user = await prisma.user.create({ data: {} });
  const role = await prisma.roleDefinition.create({
    data: {
      key: `att-reader-${uid().slice(0, 8)}`,
      name: 'Attendance Reader',
      permissions: ['attendance.read'],
      isSuperadmin: false,
      isSystem: false,
    },
  });
  await prisma.userRoleAssignment.create({ data: { userId: user.id, roleId: role.id, branchId } });
  return getPermittedBranches({ id: user.id }, 'attendance.read');
}

beforeEach(async () => {
  await resetDb();
  dayCounter = 1;
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('disputed inbox — branch-scoped read (integration)', () => {
  async function seedTwoBranches() {
    const [branchA, branchB] = await Promise.all([makeBranch('A'), makeBranch('B')]);
    const empA = await makeEmployee({ branchId: branchA.id });
    const empB = await makeEmployee({ branchId: branchB.id });
    // Rotating staff: home in B, assigned to A → an A-scoped admin CAN see them.
    const empRot = await makeEmployee({ branchId: branchB.id, assignedBranchIds: [branchA.id] });
    return { branchA, branchB, empA, empB, empRot };
  }

  it('scoped admin (branch A) sees only A-branch + rotating-in disputes, not B', async () => {
    const { branchA, empA, empB, empRot } = await seedTwoBranches();
    // The DISPUTED_SELECT does not expose employeeId (verbatim from the page),
    // so identify rows by their attendance id captured at seed time.
    const ciA = await makeCheckIn(empA, 'Disputed');
    const ciB = await makeCheckIn(empB, 'Disputed');
    const ciRot = await makeCheckIn(empRot, 'Disputed');

    const permitted = await scopedAttendanceAdmin(branchA.id);
    expect(permitted).toEqual([branchA.id]);

    const { rows } = await loadDisputedCheckIns(permitted);
    const ids = new Set(rows.map((r) => r.id));
    expect(ids).toEqual(new Set([ciA.id, ciRot.id]));
    expect(ids.has(ciB.id)).toBe(false);
  });

  it("global admin ('all') sees every branch's disputes", async () => {
    const { empA, empB, empRot } = await seedTwoBranches();
    const ciA = await makeCheckIn(empA, 'Disputed');
    const ciB = await makeCheckIn(empB, 'Disputed');
    const ciRot = await makeCheckIn(empRot, 'Disputed');

    const permitted = await scopedAttendanceAdmin(null);
    expect(permitted).toBe('all');

    const { rows } = await loadDisputedCheckIns(permitted);
    expect(new Set(rows.map((r) => r.id))).toEqual(new Set([ciA.id, ciB.id, ciRot.id]));
  });

  it('only Disputed check-ins are returned (status filter survives extraction)', async () => {
    const { empA } = await seedTwoBranches();
    await makeCheckIn(empA, 'Confirmed'); // must NOT appear
    const disputed = await makeCheckIn(empA, 'Disputed');

    const permitted = await scopedAttendanceAdmin(null); // global, so scope is inert here
    const { rows } = await loadDisputedCheckIns(permitted);
    expect(rows.map((r) => r.id)).toEqual([disputed.id]);
  });
});
