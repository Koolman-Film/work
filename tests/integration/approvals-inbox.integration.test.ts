import { Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { AssignmentForCheck } from '@/lib/auth/branch-scope';
import { loadApprovalsInbox } from '@/lib/approvals/load-inbox';
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
    data: { employeeId: emp.id, amount: new Prisma.Decimal(2500), status: 'Pending', requestedAt: new Date('2026-07-02') },
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
  return { branchId: branch.id };
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
});
