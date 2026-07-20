/**
 * Integration tests for the settlement-writing action (Task 7).
 *
 * `penalty-settlement-admin.ts` is the ONLY code in the whole
 * penalty-settled-with-leave feature that writes to
 * AttendancePenaltySettlement. Payroll (run.ts / penalty-settlement-load.ts)
 * and the leave balance (leave/balance.ts, leave/penalty-minutes.ts) only
 * ever READ it — that's what makes recalculating payroll safe. The first
 * test below is the one that proves that: settle a penalty, run payroll
 * three times, and the leave balance must move by exactly one day, not one
 * day per run.
 *
 * Mocks required because `penalty-settlement-admin.ts` is a Next.js Server
 * Action:
 *   - `@/lib/auth/check-permission` → requirePermission: bypasses Supabase
 *     session; returns the seeded admin User so `createdById` has a real id.
 *     Mirrors the pattern in liff-dispute-review.integration.test.ts.
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

import { Prisma } from '@prisma/client';
// Import AFTER vi.mock hoisting.
import { remainingByTypeForEmployee } from '@/lib/leave/balance';
import {
  clearPenaltySettlement,
  setPenaltySettlement,
} from '@/lib/payroll/penalty-settlement-admin';
import { publishPayroll, runPayrollDraft } from '@/lib/payroll/run';

function uid(): string {
  return crypto.randomUUID();
}

async function reset() {
  await prisma.attendancePenaltySettlement.deleteMany({});
  await prisma.payroll.deleteMany({});
  await prisma.overtimeEntry.deleteMany({});
  await prisma.attendance.deleteMany({});
  await prisma.cashAdvance.deleteMany({});
  await prisma.recurringDeduction.deleteMany({});
  await prisma.payrollAdjustment.deleteMany({});
  await prisma.leaveRequest.deleteMany({});
  await prisma.leaveEntitlement.deleteMany({});
  await prisma.employee.deleteMany({});
  await prisma.userRoleAssignment.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.leaveType.deleteMany({});
  await prisma.branch.deleteMany({});
  await prisma.payrollConfig.deleteMany({});
  await prisma.leaveConfig.deleteMany({});

  await prisma.payrollConfig.create({
    data: {
      ssoRate: new Prisma.Decimal('0.05'),
      ssoSalaryCap: new Prisma.Decimal(15_000),
      ssoAmountCap: new Prisma.Decimal(750),
      otMultiplier: new Prisma.Decimal('1.5'),
      absentDeductionPerDay: new Prisma.Decimal(500),
      lateDeduction: new Prisma.Decimal(100),
      earlyLeaveDeduction: new Prisma.Decimal(100),
    },
  });
  await prisma.leaveConfig.create({ data: {} });

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

/** Vacation-like type: opted into penalty settlement, generous quota. */
async function makeVacationType() {
  return prisma.leaveType.create({
    data: {
      name: `ลาพักร้อน-${uid().slice(0, 8)}`,
      annualQuota: 10,
      penaltySettlementAllowed: true,
    },
  });
}

/** Sick-like type: default (not opted in) — must never be spendable. */
async function makeSickType() {
  return prisma.leaveType.create({
    data: {
      name: `ลาป่วย-${uid().slice(0, 8)}`,
      annualQuota: 30,
      // penaltySettlementAllowed defaults to false — deliberately not set.
    },
  });
}

/** Personal-leave-like type: the second of the two seed-allowed types
 *  (ลากิจ and ลาพักร้อน), used alongside makeVacationType to test switching
 *  the settlement's leave type between two allowed types. */
async function makePersonalType() {
  return prisma.leaveType.create({
    data: {
      name: `ลากิจ-${uid().slice(0, 8)}`,
      annualQuota: 8,
      penaltySettlementAllowed: true,
    },
  });
}

beforeEach(reset);
afterAll(async () => {
  await prisma.$disconnect();
});

describe('setPenaltySettlement', () => {
  it('deducts leave once no matter how many times payroll recalculates', async () => {
    const emp = await makeEmployee();
    const vacation = await makeVacationType();

    const res = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 1,
    });
    expect(res).toEqual({ ok: true });

    // Read AFTER the settlement exists, so the assertion below is "the runs
    // moved it by zero," not "the settlement did nothing."
    const before = await remainingByTypeForEmployee(emp.id, 2026);

    await runPayrollDraft('2026-07');
    await runPayrollDraft('2026-07');
    await runPayrollDraft('2026-07');

    const after = await remainingByTypeForEmployee(emp.id, 2026);

    // Three runs, one day gone — this is the whole point of the design:
    // payroll only ever READS the settlement, it never writes it.
    expect(before[vacation.id]).not.toBeNull();
    expect(after[vacation.id]).toBe(before[vacation.id]);
  });

  it('refuses a leave type that is not allowed to pay penalties', async () => {
    const emp = await makeEmployee();
    const sick = await makeSickType();

    const r = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: sick.id,
      days: 1,
    });
    expect(r).toEqual({ ok: false, error: 'leave-type-not-allowed' });
  });

  it('refuses when the remaining balance is smaller than the penalty', async () => {
    const emp = await makeEmployee();
    const vacation = await makeVacationType(); // annualQuota: 10 days

    const r = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 99,
    });
    expect(r).toEqual({ ok: false, error: 'insufficient-balance' });
  });

  it('refuses to touch a month whose payroll is already published', async () => {
    const emp = await makeEmployee();
    const vacation = await makeVacationType();

    await runPayrollDraft('2026-06');
    await publishPayroll('2026-06', { employeeId: emp.id });

    const r = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-06',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 1,
    });
    expect(r).toEqual({ ok: false, error: 'period-closed' });
  });

  it('keeps counting an existing settlement after its leave type is disallowed', async () => {
    // Turning the flag off is a policy change going forward, not a rewrite of
    // history: leave already spent stays spent, money already withheld stays
    // withheld. Only NEW selections are blocked.
    const emp = await makeEmployee();
    const vacation = await makeVacationType();

    await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 1,
    });
    const before = await remainingByTypeForEmployee(emp.id, 2026);

    await prisma.leaveType.update({
      where: { id: vacation.id },
      data: { penaltySettlementAllowed: false },
    });

    const after = await remainingByTypeForEmployee(emp.id, 2026);
    expect(after[vacation.id]).toBe(before[vacation.id]);

    const retry = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'SevereLate',
      leaveTypeId: vacation.id,
      days: 1,
    });
    expect(retry).toEqual({ ok: false, error: 'leave-type-not-allowed' });
  });

  it('credits back the old amount when editing the SAME leave type, so raising 1 day to 2 does not charge 3', async () => {
    // This is the upsert's `update` branch — the only one of the six original
    // tests that looked like it exercised it actually created a second row
    // under a different `kind` instead. Calling setPenaltySettlement twice
    // for the identical (employeeId, month, kind) is what actually hits it.
    const emp = await makeEmployee();
    const vacation = await makeVacationType();

    const initial = await remainingByTypeForEmployee(emp.id, 2026);
    const std = initial[vacation.id]! / 10; // annualQuota: 10 days

    const first = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 1,
    });
    expect(first).toEqual({ ok: true });

    const second = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 2,
    });
    expect(second).toEqual({ ok: true });

    const rows = await prisma.attendancePenaltySettlement.findMany({
      where: { employeeId: emp.id, month: '2026-07', kind: 'Absent' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.days.toNumber()).toBe(2);

    const after = await remainingByTypeForEmployee(emp.id, 2026);
    // 2 days gone from the original balance, not 3 (1 from the first call
    // plus 2 from the second) — proof the first day was credited back.
    expect(after[vacation.id]).toBe(initial[vacation.id]! - 2 * std);
  });

  it('refuses a SAME-type edit that would exceed headroom, and leaves the stored row untouched', async () => {
    const emp = await makeEmployee();
    const vacation = await makeVacationType(); // annualQuota: 10 days

    const first = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 1,
    });
    expect(first).toEqual({ ok: true });

    // Headroom for the edit is available (9 days, since 1 is already spent)
    // plus the 1-day credit-back = 10 days. 11 exceeds it.
    const second = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 11,
    });
    expect(second).toEqual({ ok: false, error: 'insufficient-balance' });

    // A refused edit must not partially apply: the row still holds the
    // original 1 day, not 11.
    const row = await prisma.attendancePenaltySettlement.findUniqueOrThrow({
      where: {
        employeeId_month_kind: { employeeId: emp.id, month: '2026-07', kind: 'Absent' },
      },
    });
    expect(row.days.toNumber()).toBe(1);
  });

  it('moves the charge to the new leave type when the edit switches types, without crediting the old type', async () => {
    const emp = await makeEmployee();
    const vacation = await makeVacationType(); // ลาพักร้อน, annualQuota: 10
    const personal = await makePersonalType(); // ลากิจ, annualQuota: 8

    const initial = await remainingByTypeForEmployee(emp.id, 2026);
    const stdA = initial[vacation.id]! / 10;
    const stdB = initial[personal.id]! / 8;
    expect(stdA).toBe(stdB); // same config-derived standard day

    const first = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 2,
    });
    expect(first).toEqual({ ok: true });

    const switched = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: personal.id,
      days: 2,
    });
    expect(switched).toEqual({ ok: true });

    const row = await prisma.attendancePenaltySettlement.findUniqueOrThrow({
      where: {
        employeeId_month_kind: { employeeId: emp.id, month: '2026-07', kind: 'Absent' },
      },
    });
    expect(row.leaveTypeId).toBe(personal.id);

    const after = await remainingByTypeForEmployee(emp.id, 2026);
    // Type A (vacation) is fully restored — the old row's minutes must NOT
    // still be credited against it once the settlement has moved away.
    expect(after[vacation.id]).toBe(initial[vacation.id]);
    // Type B (personal) is charged the new 2 days.
    expect(after[personal.id]).toBe(initial[personal.id]! - 2 * stdB);
  });

  it('enforces invalid-days for zero and non-integer amounts, writing nothing', async () => {
    const emp = await makeEmployee();
    const vacation = await makeVacationType();

    const zero = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 0,
    });
    expect(zero).toEqual({ ok: false, error: 'invalid-days' });

    const fractional = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 1.5,
    });
    expect(fractional).toEqual({ ok: false, error: 'invalid-days' });

    const rows = await prisma.attendancePenaltySettlement.findMany({
      where: { employeeId: emp.id, month: '2026-07', kind: 'Absent' },
    });
    expect(rows).toHaveLength(0);
  });
});

describe('clearPenaltySettlement', () => {
  it('refuses to clear a settlement in a published month', async () => {
    const emp = await makeEmployee();

    await runPayrollDraft('2026-06');
    await publishPayroll('2026-06', { employeeId: emp.id });

    const r = await clearPenaltySettlement({
      employeeId: emp.id,
      month: '2026-06',
      kind: 'Absent',
    });
    expect(r).toEqual({ ok: false, error: 'period-closed' });
  });
});
