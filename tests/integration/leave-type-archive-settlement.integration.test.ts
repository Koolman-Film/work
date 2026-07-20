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
  await prisma.payroll.deleteMany({});
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
 *  integration.test.ts. `month` defaults to '2026-07' (periodYear derived
 *  from it) so existing call sites are unaffected; tests below pass an
 *  explicit month to control which Payroll row (if any) makes it closed. */
async function makeSettlement(employeeId: string, leaveTypeId: string, month = '2026-07') {
  return prisma.attendancePenaltySettlement.create({
    data: {
      employeeId,
      month,
      kind: 'Absent',
      leaveTypeId,
      days: new Prisma.Decimal(1),
      minutes: 480,
      periodYear: Number(month.slice(0, 4)),
    },
  });
}

/** A Published Payroll row for (employeeId, month) — makes that settlement's
 *  month CLOSED per `isPeriodClosed` (penalty-settlement-admin.ts) and the
 *  mirrored check in `archiveLeaveType`: any Payroll row whose status is not
 *  Draft. Money fields are irrelevant to this test (archiveLeaveType never
 *  reads them) so they're zeroed. */
async function makePublishedPayroll(employeeId: string, month: string) {
  await prisma.payroll.create({
    data: {
      employeeId,
      month,
      status: 'Published',
      publishedAt: new Date(),
      incomeBase: new Prisma.Decimal(0),
      deductSso: new Prisma.Decimal(0),
      deductAdvance: new Prisma.Decimal(0),
      deductAttendance: new Prisma.Decimal(0),
      deductLeave: new Prisma.Decimal(0),
      deductDebt: new Prisma.Decimal(0),
      deductOther: new Prisma.Decimal(0),
      netPay: new Prisma.Decimal(0),
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

describe('archiveLeaveType — closed-month settlements are archivable, open-month ones still block (Defect 4)', () => {
  it('permits the archive when the only live settlement is in a CLOSED (Published) month — it cannot be cleared, so it must not be required to be', async () => {
    const emp = await makeEmployee();
    const vacation = await makeLeaveType();
    await makeSettlement(emp.id, vacation.id, '2026-05');
    await makePublishedPayroll(emp.id, '2026-05');

    await expect(archiveLeaveType(vacation.id)).rejects.toThrow(
      /^REDIRECT:\/admin\/settings\/leave-types$/,
    );

    const after = await prisma.leaveType.findUniqueOrThrow({ where: { id: vacation.id } });
    expect(after.archivedAt).not.toBeNull();
  });

  it('still refuses when a live settlement is in an OPEN month (no Payroll row at all), and names that month', async () => {
    const emp = await makeEmployee();
    const vacation = await makeLeaveType();
    await makeSettlement(emp.id, vacation.id, '2026-06');
    // No Payroll row at all for 2026-06 — open, same as "never calculated".

    let thrown: Error | undefined;
    try {
      await archiveLeaveType(vacation.id);
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown).toBeDefined();
    const url = new URL(thrown!.message.replace(/^REDIRECT:/, ''), 'http://localhost');
    const message = decodeURIComponent(url.searchParams.get('error') ?? '');
    expect(message).toContain('2026-06');

    const after = await prisma.leaveType.findUniqueOrThrow({ where: { id: vacation.id } });
    expect(after.archivedAt).toBeNull();
  });

  it('still refuses when a live settlement is in an OPEN month with a Draft Payroll row, distinct from a Published one', async () => {
    const emp = await makeEmployee();
    const vacation = await makeLeaveType();
    await makeSettlement(emp.id, vacation.id, '2026-06');
    await prisma.payroll.create({
      data: {
        employeeId: emp.id,
        month: '2026-06',
        status: 'Draft',
        incomeBase: new Prisma.Decimal(0),
        netPay: new Prisma.Decimal(0),
      },
    });

    await expect(archiveLeaveType(vacation.id)).rejects.toThrow(
      /^REDIRECT:\/admin\/settings\/leave-types\?error=/,
    );

    const after = await prisma.leaveType.findUniqueOrThrow({ where: { id: vacation.id } });
    expect(after.archivedAt).toBeNull();
  });

  it('mixed: refuses while ANY settlement is still open, naming only the open month — not the already-closed one', async () => {
    const emp = await makeEmployee();
    const vacation = await makeLeaveType();
    // Closed month — settled and published.
    await makeSettlement(emp.id, vacation.id, '2026-05');
    await makePublishedPayroll(emp.id, '2026-05');
    // Open month — settled, never published.
    await makeSettlement(emp.id, vacation.id, '2026-06');

    let thrown: Error | undefined;
    try {
      await archiveLeaveType(vacation.id);
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown).toBeDefined();
    const url = new URL(thrown!.message.replace(/^REDIRECT:/, ''), 'http://localhost');
    const message = decodeURIComponent(url.searchParams.get('error') ?? '');
    expect(message).toContain('2026-06');
    expect(message).not.toContain('2026-05');

    const after = await prisma.leaveType.findUniqueOrThrow({ where: { id: vacation.id } });
    expect(after.archivedAt).toBeNull();

    // Now close the remaining open month too — the archive should go through.
    await makePublishedPayroll(emp.id, '2026-06');
    await expect(archiveLeaveType(vacation.id)).rejects.toThrow(
      /^REDIRECT:\/admin\/settings\/leave-types$/,
    );
    const afterBothClosed = await prisma.leaveType.findUniqueOrThrow({
      where: { id: vacation.id },
    });
    expect(afterBothClosed.archivedAt).not.toBeNull();
  });
});

describe('archiving a closed-month-settled type must not silently refund entitlement (Defect 4, leave/balance.ts)', () => {
  it('keeps subtracting a closed-month settlement’s spent minutes from remaining balance after the type is archived', async () => {
    const { remainingByTypeForEmployee, getOrSeedEntitlements } = await import(
      '@/lib/leave/balance'
    );

    const emp = await makeEmployee();
    const vacation = await makeLeaveType(); // annualQuota: 10 days
    // Seed the entitlement row for 2026 the same way a normal admin visit would
    // (getOrSeedEntitlements creates it lazily) — done BEFORE archiving, while
    // the type is still active, exactly like production.
    const before = await getOrSeedEntitlements(emp.id, 2026);
    const entBefore = before.find((r) => r.leaveTypeId === vacation.id);
    expect(entBefore).toBeDefined();
    const remainingBefore = entBefore!.remainingMinutes;

    await makeSettlement(emp.id, vacation.id, '2026-05'); // 480 minutes, 1 day
    await makePublishedPayroll(emp.id, '2026-05');

    await expect(archiveLeaveType(vacation.id)).rejects.toThrow(
      /^REDIRECT:\/admin\/settings\/leave-types$/,
    );
    const archived = await prisma.leaveType.findUniqueOrThrow({ where: { id: vacation.id } });
    expect(archived.archivedAt).not.toBeNull();

    // Both balance readers must still show the type (not silently drop it)
    // AND still show the 480 minutes as spent — not refunded.
    const remaining = await remainingByTypeForEmployee(emp.id, 2026);
    expect(remaining[vacation.id]).toBe(remainingBefore! - 480);

    const after = await getOrSeedEntitlements(emp.id, 2026);
    const entAfter = after.find((r) => r.leaveTypeId === vacation.id);
    expect(entAfter).toBeDefined();
    expect(entAfter!.remainingMinutes).toBe(remainingBefore! - 480);
  });

  it('an archived type with NO settlement for this employee/year stays out of the enumeration (unaffected by the Defect 4 fix)', async () => {
    const { remainingByTypeForEmployee } = await import('@/lib/leave/balance');

    const emp = await makeEmployee();
    const vacation = await makeLeaveType();
    await prisma.leaveType.update({ where: { id: vacation.id }, data: { archivedAt: new Date() } });

    const remaining = await remainingByTypeForEmployee(emp.id, 2026);
    expect(remaining[vacation.id]).toBeUndefined();
  });

  it('remainingByTypeForEmployees (bulk) applies an archived, still-settled type ONLY to the employee that has the live settlement, not batch-wide', async () => {
    // Pins the bug the function's own doc comment already promised was fixed:
    // settledLeaveTypeIds used to be computed once for the whole batch, then
    // every archived type it returned was looped over EVERY employee in the
    // batch — so an employee with no settlement for that type still picked up
    // a (wrong) full-quota entry for it. This test seeds TWO employees
    // sharing one archived+settled leave type: one has a live settlement
    // against it, the other doesn't, and only the settled one may see an
    // entry for it.
    const { remainingByTypeForEmployees } = await import('@/lib/leave/balance');

    const settledEmp = await makeEmployee();
    const untouchedEmp = await makeEmployee();
    const vacation = await makeLeaveType(); // annualQuota: 10 days

    // Read the settled employee's balance for this type BEFORE the settlement
    // and the archive, so the expected post-settlement value doesn't need to
    // hardcode the standard-day-minutes config.
    const before = await remainingByTypeForEmployees([settledEmp.id], 2026);
    const remainingBefore = before[settledEmp.id]![vacation.id];

    await makeSettlement(settledEmp.id, vacation.id, '2026-05'); // 480 minutes, 1 day
    await makePublishedPayroll(settledEmp.id, '2026-05'); // closed month — archivable

    await prisma.leaveType.update({ where: { id: vacation.id }, data: { archivedAt: new Date() } });

    const remaining = await remainingByTypeForEmployees([settledEmp.id, untouchedEmp.id], 2026);

    // The settled employee keeps an entry for the archived type, with the
    // settlement's 480 minutes subtracted — not refunded by the archive.
    expect(remaining[settledEmp.id]![vacation.id]).toBe(remainingBefore! - 480);

    // The untouched employee has no settlement for this type at all — it must
    // not appear in their map (the Defect 4 batch-wide leak this test guards
    // against would give them a full-quota entry instead).
    expect(remaining[untouchedEmp.id]![vacation.id]).toBeUndefined();
  });
});
