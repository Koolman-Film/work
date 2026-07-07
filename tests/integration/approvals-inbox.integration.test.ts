import { Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadApprovalsInbox } from '@/lib/approvals/load-inbox';
import type { AssignmentForCheck } from '@/lib/auth/branch-scope';
import { prisma } from '@/lib/db/prisma';

const superadmin: AssignmentForCheck[] = [
  { branchId: null, role: { isSuperadmin: true, permissions: [], archivedAt: null } },
];
const leaveOnly: AssignmentForCheck[] = [
  { branchId: null, role: { isSuperadmin: false, permissions: ['leave.read'], archivedAt: null } },
];

async function reset() {
  await prisma.attendance.deleteMany({});
  await prisma.cashAdvance.deleteMany({});
  await prisma.leaveRequest.deleteMany({});
  await prisma.leaveType.deleteMany({});
  await prisma.employee.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.branch.deleteMany({});
}

async function seed() {
  const branch = await prisma.branch.create({
    data: { name: 'HQ', latitude: 13.75, longitude: 100.5, radiusMeters: 100 },
  });
  const user = await prisma.user.create({ data: {} });
  const emp = await prisma.employee.create({
    data: {
      userId: user.id,
      firstName: 'สม',
      lastName: 'ชาย',
      branchId: branch.id,
      salaryType: 'Monthly',
      baseSalary: new Prisma.Decimal(20000),
      status: 'Active',
      hiredAt: new Date('2026-01-01'),
    },
  });
  const lt = await prisma.leaveType.create({ data: { name: 'ลาป่วย', isPaid: true } });
  await prisma.leaveRequest.create({
    data: {
      employeeId: emp.id,
      leaveTypeId: lt.id,
      startDate: new Date('2026-07-10'),
      endDate: new Date('2026-07-10'),
      unit: 'FullDay',
      reason: 'x',
      status: 'Pending',
      createdAt: new Date('2026-07-01'),
    },
  });
  await prisma.cashAdvance.create({
    data: {
      employeeId: emp.id,
      amount: new Prisma.Decimal(2500),
      status: 'Pending',
      requestedAt: new Date('2026-07-02'),
    },
  });
  await prisma.leaveRequest.create({
    data: {
      employeeId: emp.id,
      leaveTypeId: lt.id,
      startDate: new Date('2026-06-01'),
      endDate: new Date('2026-06-01'),
      unit: 'FullDay',
      reason: 'old',
      status: 'Approved',
      createdAt: new Date('2026-06-01'),
    },
  });
  return { branchId: branch.id, empId: emp.id, userId: user.id };
}

async function seedDisputed(emp: { id: string; userId: string; branchId: string }) {
  // Disputed check-in with a matched branch (out-of-range / accuracy style dispute).
  const withBranch = await prisma.attendance.create({
    data: {
      employeeId: emp.id,
      date: new Date('2026-07-03'),
      type: 'CheckIn',
      source: 'Liff',
      checkInStatus: 'Disputed',
      clockInAt: new Date('2026-07-03T02:30:00Z'),
      checkInLat: new Prisma.Decimal(13.7573),
      checkInLng: new Prisma.Decimal(100.5018),
      checkInBranchId: emp.branchId,
      disputeReason: 'out-of-range',
      createdById: emp.userId,
    },
  });
  // Disputed check-in with NO configured branch (evaluate.ts's
  // `no-configured-branch` reason) — checkInBranchId is null. This is the
  // row shape that used to crash `mapDisputedCard` by dereferencing
  // `checkInBranch.latitude` on a null `checkInBranch`.
  const noBranch = await prisma.attendance.create({
    data: {
      employeeId: emp.id,
      date: new Date('2026-07-04'),
      type: 'CheckIn',
      source: 'Liff',
      checkInStatus: 'Disputed',
      clockInAt: new Date('2026-07-04T02:30:00Z'),
      checkInLat: new Prisma.Decimal(13.76),
      checkInLng: new Prisma.Decimal(100.51),
      checkInBranchId: null,
      disputeReason: 'no-configured-branch',
      createdById: emp.userId,
    },
  });
  return { withBranch, noBranch };
}

beforeEach(reset);
afterAll(async () => {
  await prisma.$disconnect();
});

describe('loadApprovalsInbox', () => {
  it('aggregates pending leave + advance, newest first, excludes non-pending', async () => {
    await seed();
    const { cards, counts } = await loadApprovalsInbox(superadmin, {});
    expect(counts.leave).toBe(1);
    expect(counts.advance).toBe(1);
    expect(counts.total).toBe(2);
    expect(cards.map((c) => c.type)).toEqual(['advance', 'leave']); // advance 07-02 newer than leave 07-01
  });

  it('scopes by permission: leave.read only sees leave', async () => {
    await seed();
    const { cards, counts } = await loadApprovalsInbox(leaveOnly, {});
    expect(counts.advance).toBe(0);
    expect(counts.leave).toBe(1);
    expect(cards.every((c) => c.type === 'leave')).toBe(true);
  });

  it('applies the type filter', async () => {
    await seed();
    const { cards } = await loadApprovalsInbox(superadmin, { type: 'advance' });
    expect(cards).toHaveLength(1);
    expect(cards[0]?.type).toBe('advance');
  });

  it('includes disputed check-ins, incl. ones with no configured branch, without throwing', async () => {
    const { branchId, empId, userId } = await seed();
    const { withBranch, noBranch } = await seedDisputed({ id: empId, userId, branchId });

    const { cards, counts } = await loadApprovalsInbox(superadmin, {});

    expect(counts.disputed).toBe(2);
    const disputedCards = cards.filter((c) => c.type === 'disputed');
    expect(disputedCards).toHaveLength(2);
    const ids = disputedCards.map((c) => c.id).sort();
    expect(ids).toEqual([withBranch.id, noBranch.id].sort());

    const noBranchCard = disputedCards.find((c) => c.id === noBranch.id) as
      | { distanceMeters: number | null }
      | undefined;
    expect(noBranchCard?.distanceMeters).toBeNull();

    const withBranchCard = disputedCards.find((c) => c.id === withBranch.id) as
      | { distanceMeters: number | null }
      | undefined;
    expect(withBranchCard?.distanceMeters).not.toBeNull();
  });
});
