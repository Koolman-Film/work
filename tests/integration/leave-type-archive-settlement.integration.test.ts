/**
 * Integration test for Defect 4: archiving a leave type must not silently
 * refund entitlement already spent by a live AttendancePenaltySettlement.
 *
 * `archiveLeaveType` (settings/leave-types/actions.ts) already blocks the
 * archive when a LeaveRequest still references the type
 * (Pending/Approved) — it did NOT check AttendancePenaltySettlement. The
 * three balance readers in leave/balance.ts (getOrSeedEntitlements,
 * remainingByTypeForEmployees, remainingByTypeForEmployee) all enumerate
 * leave types filtered on `archivedAt: null` and call `penaltyMinutes`
 * inside that loop, so archiving a type out from under a live settlement
 * would silently stop subtracting its spent minutes (the employee gets the
 * days back) while `loadSettlementsForMonth` (payroll/penalty-settlement-
 * load.ts, which has no archived filter) keeps applying the money offset —
 * entitlement refunded, money still forgiven, with nothing in the codebase
 * noticing the mismatch.
 *
 * Mocks required because `archiveLeaveType` is a Next.js Server Action:
 *   - `@/lib/auth/check-permission` → requirePermission: bypasses Supabase
 *     session, returns the seeded admin User so auditLog has a real actorId.
 *   - `next/navigation` → redirect: throws a distinguishable error carrying
 *     the target URL instead of actually redirecting (there is no Next.js
 *     request context in a plain vitest run) — EVERY path through this
 *     action ends in a redirect(), success included.
 *   - `next/cache` → revalidatePath: no-op; there is no Next.js cache here.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db/prisma';

const adminUserHolder: { id: string } = { id: '00000000-0000-0000-0000-000000000000' };

vi.mock('@/lib/auth/check-permission', () => ({
  requirePermission: vi.fn(async () => ({
    user: adminUserHolder,
    authUserId: adminUserHolder.id,
    tier: 'Admin',
  })),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import { Prisma } from '@prisma/client';
// Import AFTER vi.mock hoisting.
import { archiveLeaveType } from '@/app/(admin)/admin/settings/leave-types/actions';

function uid(): string {
  return crypto.randomUUID();
}

async function reset() {
  await prisma.attendancePenaltySettlement.deleteMany({});
  await prisma.leaveRequest.deleteMany({});
  await prisma.leaveEntitlement.deleteMany({});
  await prisma.employee.deleteMany({});
  await prisma.leaveType.deleteMany({});
  await prisma.branch.deleteMany({});
  await prisma.user.deleteMany({});

  const adminUser = await prisma.user.create({ data: {} });
  adminUserHolder.id = adminUser.id;
}

async function makeEmployee() {
  const user = await prisma.user.create({ data: {} });
  const branch = await prisma.branch.create({ data: { name: `Branch-${uid().slice(0, 8)}` } });
  return prisma.employee.create({
    data: {
      userId: user.id,
      firstName: 'Test',
      lastName: 'Worker',
      branchId: branch.id,
      salaryType: 'Monthly',
      baseSalary: new Prisma.Decimal(20_000),
      status: 'Active',
      hiredAt: new Date('2026-01-01'),
    },
  });
}

async function makeLeaveType() {
  return prisma.leaveType.create({
    data: {
      name: `ลาพักร้อน-${uid().slice(0, 8)}`,
      annualQuota: 10,
      penaltySettlementAllowed: true,
    },
  });
}

/** Directly inserts a live AttendancePenaltySettlement row. Bypasses
 *  `setPenaltySettlement` (the table's only production writer) deliberately —
 *  this test targets archiveLeaveType's own reference count, not the
 *  settlement-writing guards already covered by penalty-settlement.
 *  integration.test.ts. */
async function makeSettlement(employeeId: string, leaveTypeId: string) {
  return prisma.attendancePenaltySettlement.create({
    data: {
      employeeId,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId,
      days: new Prisma.Decimal(1),
      minutes: 480,
      periodYear: 2026,
    },
  });
}

beforeEach(reset);
afterAll(async () => {
  await prisma.$disconnect();
});

describe('archiveLeaveType — blocks a live AttendancePenaltySettlement reference (Defect 4)', () => {
  it('refuses to archive while a live settlement still references the type', async () => {
    const emp = await makeEmployee();
    const vacation = await makeLeaveType();
    await makeSettlement(emp.id, vacation.id);

    await expect(archiveLeaveType(vacation.id)).rejects.toThrow(
      /^REDIRECT:\/admin\/settings\/leave-types\?error=/,
    );

    const after = await prisma.leaveType.findUniqueOrThrow({ where: { id: vacation.id } });
    expect(after.archivedAt).toBeNull();
  });

  it('names the count of live settlements in the redirect error message', async () => {
    const empA = await makeEmployee();
    const empB = await makeEmployee();
    const vacation = await makeLeaveType();
    await makeSettlement(empA.id, vacation.id);
    await makeSettlement(empB.id, vacation.id);

    let thrown: Error | undefined;
    try {
      await archiveLeaveType(vacation.id);
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown).toBeDefined();
    const url = new URL(thrown!.message.replace(/^REDIRECT:/, ''), 'http://localhost');
    const message = decodeURIComponent(url.searchParams.get('error') ?? '');
    expect(message).toContain('2');
    expect(message).toContain('หักค่าปรับด้วยสิทธิวันลา');
  });

  it('permits the archive once the settlement is no longer live (soft-deleted)', async () => {
    const emp = await makeEmployee();
    const vacation = await makeLeaveType();
    const settlement = await makeSettlement(emp.id, vacation.id);

    await expect(archiveLeaveType(vacation.id)).rejects.toThrow(
      /^REDIRECT:\/admin\/settings\/leave-types\?error=/,
    );

    await prisma.attendancePenaltySettlement.update({
      where: { id: settlement.id },
      data: { deletedAt: new Date() },
    });

    await expect(archiveLeaveType(vacation.id)).rejects.toThrow(
      /^REDIRECT:\/admin\/settings\/leave-types$/,
    );

    const after = await prisma.leaveType.findUniqueOrThrow({ where: { id: vacation.id } });
    expect(after.archivedAt).not.toBeNull();
  });

  it('still refuses on a live LeaveRequest reference, unaffected by this fix (pre-existing guard)', async () => {
    const emp = await makeEmployee();
    const vacation = await makeLeaveType();
    await prisma.leaveRequest.create({
      data: {
        employeeId: emp.id,
        leaveTypeId: vacation.id,
        status: 'Pending',
        startDate: new Date('2026-07-10'),
        endDate: new Date('2026-07-10'),
        unit: 'FullDay',
        reason: 'test',
      },
    });

    await expect(archiveLeaveType(vacation.id)).rejects.toThrow(
      /^REDIRECT:\/admin\/settings\/leave-types\?error=/,
    );

    const after = await prisma.leaveType.findUniqueOrThrow({ where: { id: vacation.id } });
    expect(after.archivedAt).toBeNull();
  });
});
