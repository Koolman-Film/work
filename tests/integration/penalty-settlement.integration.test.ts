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
  // approveLeaveRequest (leave/admin.ts) branch-scope-gates via
  // getPermittedBranches → getUserAssignments — stub a superadmin (global)
  // grant so `permitted = 'all'` and the gate passes regardless of which
  // branch the test's employee is on. Mirrors
  // liff-dispute-review.integration.test.ts.
  getUserAssignments: vi.fn(async () => [
    {
      branchId: null,
      role: {
        id: 'test-superadmin',
        key: 'superadmin',
        name: 'Superadmin',
        permissions: [],
        isSuperadmin: true,
        archivedAt: null,
      },
    },
  ]),
}));

// approveLeaveRequest reads request headers (IP / user-agent) that don't
// exist outside a real Next.js request context.
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => ({
    get: (_name: string) => null,
  })),
}));

// approveLeaveRequest fires a fire-and-forget Inngest notification after
// commit — not exercised here (separate Inngest integration concern).
vi.mock('@/lib/inngest/events', () => ({
  sendNotification: vi.fn(async () => undefined),
}));

import { Prisma } from '@prisma/client';
// Import AFTER vi.mock hoisting.
import { approveLeaveRequest } from '@/lib/leave/admin';
import { overQuotaPreview } from '@/lib/leave/approval-preview';
import {
  getOrSeedEntitlements,
  remainingByTypeForEmployee,
  remainingByTypeForEmployees,
} from '@/lib/leave/balance';
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

async function makeEmployee(overrides: { salaryType?: 'Monthly' | 'Daily' | 'Hourly' } = {}) {
  const user = await prisma.user.create({ data: {} });
  const branch = await prisma.branch.create({ data: { name: `Branch-${uid().slice(0, 8)}` } });
  return prisma.employee.create({
    data: {
      userId: user.id,
      firstName: 'Test',
      lastName: 'Worker',
      branchId: branch.id,
      salaryType: overrides.salaryType ?? 'Monthly',
      baseSalary: new Prisma.Decimal(20_000),
      status: 'Active',
      hiredAt: new Date('2026-01-01'),
    },
  });
}

/** One Absent attendance row inside the default 2026-07 cutoff window
 *  (cutoffDay 25 → 2026-06-26..2026-07-25) — gives the employee exactly one
 *  actual Absent-penalty day for that month, the precondition Defect 2's
 *  `exceeds-penalty` guard now requires before a settlement can spend leave
 *  against it. */
async function makeAbsence(employeeId: string, date = '2026-07-01') {
  await prisma.attendance.create({
    data: {
      employeeId,
      date: new Date(date),
      type: 'Absent',
      source: 'Manual',
      createdById: uid(),
    },
  });
}

/** One Late attendance row inside the same window. `minutesLate` decides
 *  which bucket it lands in under the default policy (severeLateEnabled:
 *  true, severeLateThresholdMin: 30, lateThreeStrikeEnabled: true,
 *  threeStrikeCount: 3): >30 counts toward SevereLate, <=30 toward the
 *  tier-1/three-strike count. */
async function makeLate(employeeId: string, date: string, minutesLate: number) {
  await prisma.attendance.create({
    data: {
      employeeId,
      date: new Date(date),
      type: 'Late',
      durationMinutes: minutesLate,
      source: 'Manual',
      createdById: uid(),
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
    await makeAbsence(emp.id); // the actual penalty the 1-day settlement below settles

    const res = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 1,
      via: 'reconcile',
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
      via: 'reconcile',
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
      via: 'reconcile',
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
      via: 'reconcile',
    });
    expect(r).toEqual({ ok: false, error: 'period-closed' });
  });

  it('keeps counting an existing settlement after its leave type is disallowed', async () => {
    // Turning the flag off is a policy change going forward, not a rewrite of
    // history: leave already spent stays spent, money already withheld stays
    // withheld. Only NEW selections are blocked.
    const emp = await makeEmployee();
    const vacation = await makeVacationType();
    await makeAbsence(emp.id);

    await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 1,
      via: 'reconcile',
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
      via: 'reconcile',
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
    // Two actual Absent days this month — the 2-day edit below settles both.
    await makeAbsence(emp.id, '2026-07-01');
    await makeAbsence(emp.id, '2026-07-02');

    const initial = await remainingByTypeForEmployee(emp.id, 2026);
    const std = initial[vacation.id]! / 10; // annualQuota: 10 days

    const first = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 1,
      via: 'reconcile',
    });
    expect(first).toEqual({ ok: true });

    const second = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 2,
      via: 'reconcile',
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
    await makeAbsence(emp.id);

    const first = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 1,
      via: 'reconcile',
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
      via: 'reconcile',
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
    // Two actual Absent days — both calls below settle 2 days of the SAME
    // kind (Absent), just moved between leave types.
    await makeAbsence(emp.id, '2026-07-01');
    await makeAbsence(emp.id, '2026-07-02');

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
      via: 'reconcile',
    });
    expect(first).toEqual({ ok: true });

    const switched = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: personal.id,
      days: 2,
      via: 'reconcile',
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
      via: 'reconcile',
    });
    expect(zero).toEqual({ ok: false, error: 'invalid-days' });

    const fractional = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 1.5,
      via: 'reconcile',
    });
    expect(fractional).toEqual({ ok: false, error: 'invalid-days' });

    const rows = await prisma.attendancePenaltySettlement.findMany({
      where: { employeeId: emp.id, month: '2026-07', kind: 'Absent' },
    });
    expect(rows).toHaveLength(0);
  });

  it('refuses a malformed month, writing nothing — the reconcile page validates its own month, but the manual attendance form derives one client-side from a cutoff-day prop, so the server must not trust it verbatim', async () => {
    const emp = await makeEmployee();
    const vacation = await makeVacationType();

    for (const badMonth of ['2026-13', '2026-00', '2026-7', '2026/07', 'not-a-month', '']) {
      const r = await setPenaltySettlement({
        employeeId: emp.id,
        month: badMonth,
        kind: 'Absent',
        leaveTypeId: vacation.id,
        days: 1,
        via: 'reconcile',
      });
      expect(r).toEqual({ ok: false, error: 'invalid-month' });
    }

    const rows = await prisma.attendancePenaltySettlement.findMany({
      where: { employeeId: emp.id },
    });
    expect(rows).toHaveLength(0);
  });

  it('serializes two concurrent settlements on DIFFERENT kinds for the same employee/month so together they cannot overspend the balance (Finding 1, cross-kind race)', async () => {
    // Without the row lock, both calls read `available` before either writes,
    // both see the same 1-day headroom, and both succeed — driving the
    // balance to -1 day. `ลาพักร้อน`-shaped types run `overQuotaPolicy:
    // Block` in production, so a negative balance there blocks the employee
    // from taking any vacation for the rest of the year. The lock forces one
    // call to wait for the other's full commit before it re-reads the
    // balance, so this is a genuine race test — not timing-dependent on
    // which one "wins," only on the outcome being correct either way.
    const emp = await makeEmployee();
    const vacation = await prisma.leaveType.create({
      data: {
        name: `ลาพักร้อน-${uid().slice(0, 8)}`,
        annualQuota: 1, // exactly one day of headroom, shared by both calls
        penaltySettlementAllowed: true,
      },
    });
    // Both kinds need an actual 1-day penalty this month for either 1-day
    // settle call to be accepted (Defect 2's exceeds-penalty guard) —
    // otherwise whichever call wins the balance race would still be refused
    // for exceeding a (nonexistent) penalty instead of proving the race.
    await makeAbsence(emp.id);
    await makeLate(emp.id, '2026-07-02', 45); // severe (> default 30-min threshold)

    const initial = await remainingByTypeForEmployee(emp.id, 2026);
    const std = initial[vacation.id]!; // annualQuota: 1 day == the whole balance

    // A Draft Payroll row is not required for the advisory lock (it's keyed
    // on the month, not on any row — see month-lock.ts), but it IS the state
    // the reconcile page settles against in practice (it only shows a
    // penalty once "คำนวณ" has produced a Draft row), so this is still
    // realistic setup.
    await runPayrollDraft('2026-07');

    const [absentResult, severeResult] = await Promise.all([
      setPenaltySettlement({
        employeeId: emp.id,
        month: '2026-07',
        kind: 'Absent',
        leaveTypeId: vacation.id,
        days: 1,
        via: 'reconcile',
      }),
      setPenaltySettlement({
        employeeId: emp.id,
        month: '2026-07',
        kind: 'SevereLate',
        leaveTypeId: vacation.id,
        days: 1,
        via: 'reconcile',
      }),
    ]);

    const results = [absentResult, severeResult];
    const succeeded = results.filter((r) => r.ok);
    const refused = results.filter((r) => !r.ok);

    // Exactly one of the two 1-day requests fits in the 1-day balance —
    // never both (the pre-fix bug) and never neither (over-strict).
    expect(succeeded).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toEqual({ ok: false, error: 'insufficient-balance' });

    const after = await remainingByTypeForEmployee(emp.id, 2026);
    // Exactly one day gone, not two, and never negative.
    expect(after[vacation.id]).toBe(initial[vacation.id]! - std);
    expect(after[vacation.id]).toBeGreaterThanOrEqual(0);

    const rows = await prisma.attendancePenaltySettlement.findMany({
      where: { employeeId: emp.id, month: '2026-07' },
    });
    expect(rows).toHaveLength(1);
  });
});

describe('publishPayroll vs setPenaltySettlement (publish-side lock race)', () => {
  it('never lets a concurrent settle and publish disagree — settled money and settled leave move together or not at all', async () => {
    // Genuine race, not timing-dependent: both calls run truly concurrently
    // via Promise.all against real Postgres row locks, so this test does not
    // assert which one "wins" — only that whichever wins, the outcome is
    // internally consistent. Before the publish-side lock (this fix), the
    // failure mode was: settle wins the write to AttendancePenaltySettlement
    // (spending a day of leave) but publish's already-in-flight gatherAndCalc
    // read ran before that commit and stamps the slip with the FULL, unsettled
    // ฿666.67 charge — money and leave both consumed for the same day, with
    // no way to fix it afterward (clearPenaltySettlement refuses a closed
    // period).
    const emp = await makeEmployee();
    const vacation = await makeVacationType();

    // One Absent day inside the 2026-07 cutoff window (default cutoffDay 25 →
    // window 2026-06-26..2026-07-25).
    await prisma.attendance.create({
      data: {
        employeeId: emp.id,
        date: new Date('2026-07-01'),
        type: 'Absent',
        source: 'Manual',
        createdById: uid(),
      },
    });

    // A Draft row must exist before the race — exactly the state the
    // reconcile page settles against in practice, and the state that gives
    // both the settle lock and the new publish lock something to lock. See
    // the identical setup note on the cross-kind race test above.
    await runPayrollDraft('2026-07');
    const draftRow = await prisma.payroll.findFirstOrThrow({
      where: { employeeId: emp.id, month: '2026-07' },
    });
    expect(Number(draftRow.deductAttendance)).toBe(666.67); // unsettled: full day

    const [settleResult] = await Promise.all([
      setPenaltySettlement({
        employeeId: emp.id,
        month: '2026-07',
        kind: 'Absent',
        leaveTypeId: vacation.id,
        days: 1,
        via: 'reconcile',
      }),
      publishPayroll('2026-07', { employeeId: emp.id }),
    ]);

    const publishedRow = await prisma.payroll.findFirstOrThrow({
      where: { employeeId: emp.id, month: '2026-07' },
    });
    expect(publishedRow.status).toBe('Published');

    const settlementRow = await prisma.attendancePenaltySettlement.findUnique({
      where: {
        employeeId_month_kind: { employeeId: emp.id, month: '2026-07', kind: 'Absent' },
      },
    });
    const settlementLive = settlementRow && !settlementRow.deletedAt ? settlementRow : null;

    if (settleResult.ok) {
      // Settle won the lock and committed before publish's gatherAndCalc
      // read — the published slip MUST reflect it: no money AND the day of
      // leave spent, never money charged on top.
      expect(settlementLive).not.toBeNull();
      expect(Number(publishedRow.deductAttendance)).toBe(0);
    } else {
      // Publish won the lock, committed first, and closed the period — the
      // settle call must have been correctly refused (not silently dropped),
      // and the slip carries the full unsettled charge with NO leave spent.
      expect(settleResult).toEqual({ ok: false, error: 'period-closed' });
      expect(settlementLive).toBeNull();
      expect(Number(publishedRow.deductAttendance)).toBe(666.67);
    }
  });

  it('never lets a concurrent settle and publish disagree even when NO Payroll row exists yet for the employee/month (Finding 1, zero-row race)', async () => {
    // Deliberately do NOT call runPayrollDraft first — the point of this
    // test. `FOR UPDATE` locks nothing when no row matches, so a row lock
    // (the pre-fix code) leaves this case completely unprotected even
    // though it's reachable in production: the manual attendance form lets
    // an admin settle a penalty with leave without ever visiting the
    // reconcile page or running "คำนวณ" first, so an employee can be
    // settled before any Draft row for the month exists. publishPayroll's
    // upsert has a `create` branch (run.ts) that writes a Published row in
    // exactly that situation — publish does not merely stamp existing rows,
    // it can create them. The advisory lock (month-lock.ts) protects this
    // because it's keyed on the month string, not on row existence.
    const emp = await makeEmployee();
    const vacation = await makeVacationType();

    // One Absent day inside the 2026-07 cutoff window (default cutoffDay 25
    // → window 2026-06-26..2026-07-25) — same shape as the sibling test
    // above, minus the runPayrollDraft call.
    await prisma.attendance.create({
      data: {
        employeeId: emp.id,
        date: new Date('2026-07-01'),
        type: 'Absent',
        source: 'Manual',
        createdById: uid(),
      },
    });

    const before = await prisma.payroll.findFirst({
      where: { employeeId: emp.id, month: '2026-07' },
    });
    expect(before).toBeNull(); // no row for anything to (row-)lock

    const [settleResult] = await Promise.all([
      setPenaltySettlement({
        employeeId: emp.id,
        month: '2026-07',
        kind: 'Absent',
        leaveTypeId: vacation.id,
        days: 1,
        via: 'reconcile',
      }),
      publishPayroll('2026-07', { employeeId: emp.id }),
    ]);

    const publishedRow = await prisma.payroll.findFirstOrThrow({
      where: { employeeId: emp.id, month: '2026-07' },
    });
    expect(publishedRow.status).toBe('Published');

    const settlementRow = await prisma.attendancePenaltySettlement.findUnique({
      where: {
        employeeId_month_kind: { employeeId: emp.id, month: '2026-07', kind: 'Absent' },
      },
    });
    const settlementLive = settlementRow && !settlementRow.deletedAt ? settlementRow : null;

    // Same consistency invariant as the sibling test: either the settlement
    // applied and the published money reflects it, or it was refused with
    // `period-closed` and the money is the full unsettled amount — never
    // both a spent day of leave AND the full ฿666.67 charge, which is the
    // unrecoverable double-charge this test guards against (clear refuses a
    // closed period, so there would be no way to undo it).
    if (settleResult.ok) {
      expect(settlementLive).not.toBeNull();
      expect(Number(publishedRow.deductAttendance)).toBe(0);
    } else {
      expect(settleResult).toEqual({ ok: false, error: 'period-closed' });
      expect(settlementLive).toBeNull();
      expect(Number(publishedRow.deductAttendance)).toBe(666.67);
    }
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
      via: 'reconcile',
    });
    expect(r).toEqual({ ok: false, error: 'period-closed' });
  });

  it('refuses a malformed month, writing nothing', async () => {
    const emp = await makeEmployee();

    const r = await clearPenaltySettlement({
      employeeId: emp.id,
      month: 'not-a-month',
      kind: 'Absent',
      via: 'reconcile',
    });
    expect(r).toEqual({ ok: false, error: 'invalid-month' });
  });
});

describe('audit trail', () => {
  async function rawAuditRowsFor(employeeId: string) {
    const rows = await prisma.auditLog.findMany({
      where: { entityType: 'AttendancePenaltySettlement' },
      orderBy: { createdAt: 'asc' },
    });
    return rows.filter((r) => {
      const before = r.beforeValue as { employeeId?: string } | null;
      const after = r.afterValue as { employeeId?: string } | null;
      return before?.employeeId === employeeId || after?.employeeId === employeeId;
    });
  }

  // auditLog() is fire-and-forget (see src/lib/audit/log.ts) — the write is
  // kicked off but not awaited by setPenaltySettlement/clearPenaltySettlement.
  // Poll briefly instead of asserting immediately, so this test isn't racing
  // an in-flight insert.
  async function auditRowsFor(employeeId: string, atLeast: number) {
    const deadline = Date.now() + 2000;
    let rows = await rawAuditRowsFor(employeeId);
    while (rows.length < atLeast && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      rows = await rawAuditRowsFor(employeeId);
    }
    return rows;
  }

  it('writes an audit entry naming the actor and the new values when creating a settlement', async () => {
    const emp = await makeEmployee();
    const vacation = await makeVacationType();
    await makeAbsence(emp.id);

    const res = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 1,
      via: 'reconcile',
    });
    expect(res).toEqual({ ok: true });

    const rows = await auditRowsFor(emp.id, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('penaltySettlement.create');
    expect(rows[0]!.actorId).toBe(adminUserHolder.id);
    expect(rows[0]!.beforeValue).toBeNull();
    expect(rows[0]!.afterValue).toMatchObject({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 1,
    });
  });

  it('writes an audit entry carrying the previous values when editing a settlement', async () => {
    const emp = await makeEmployee();
    const vacation = await makeVacationType();
    await makeAbsence(emp.id, '2026-07-01');
    await makeAbsence(emp.id, '2026-07-02'); // 2 actual days — covers the day1→day2 edit below

    await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 1,
      via: 'reconcile',
    });

    const edited = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 2,
      via: 'reconcile',
    });
    expect(edited).toEqual({ ok: true });

    const rows = await auditRowsFor(emp.id, 2);
    expect(rows).toHaveLength(2);
    const editRow = rows[1]!;
    expect(editRow.action).toBe('penaltySettlement.update');
    expect(editRow.actorId).toBe(adminUserHolder.id);
    expect(editRow.beforeValue).toMatchObject({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 1,
    });
    expect(editRow.afterValue).toMatchObject({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 2,
    });
  });

  it('writes an audit entry when clearing a settlement', async () => {
    const emp = await makeEmployee();
    const vacation = await makeVacationType();
    await makeAbsence(emp.id);

    await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 1,
      via: 'reconcile',
    });

    const cleared = await clearPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      via: 'reconcile',
    });
    expect(cleared).toEqual({ ok: true });

    const rows = await auditRowsFor(emp.id, 2);
    expect(rows).toHaveLength(2);
    const clearRow = rows[1]!;
    expect(clearRow.action).toBe('penaltySettlement.clear');
    expect(clearRow.actorId).toBe(adminUserHolder.id);
    expect(clearRow.beforeValue).toMatchObject({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 1,
    });
  });

  it('audits a re-settle after a clear as a fresh create, not an update carrying stale before-values', async () => {
    // The soft-deleted row is still sitting there with deletedAt set when the
    // second setPenaltySettlement call runs its upsert (Prisma's `update`
    // branch fires because the unique key already exists). Without the
    // deletedAt filter on the audit-classification decision, this would log
    // as `penaltySettlement.update` with a `before` block describing values
    // that were no longer live — Finding 5 of the review.
    const emp = await makeEmployee();
    const vacation = await makeVacationType();
    await makeAbsence(emp.id);

    const first = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 1,
      via: 'reconcile',
    });
    expect(first).toEqual({ ok: true });

    const cleared = await clearPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      via: 'reconcile',
    });
    expect(cleared).toEqual({ ok: true });

    const resettled = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 1,
      via: 'reconcile',
    });
    expect(resettled).toEqual({ ok: true });

    // create, clear, create — never an update, because the row the second
    // setPenaltySettlement call found was soft-deleted, not live.
    const rows = await auditRowsFor(emp.id, 3);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.action)).toEqual([
      'penaltySettlement.create',
      'penaltySettlement.clear',
      'penaltySettlement.create',
    ]);
    expect(rows[2]!.beforeValue).toBeNull();
    expect(rows[2]!.afterValue).toMatchObject({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 1,
    });
  });

  it('writes no audit entry when a call is refused for insufficient balance', async () => {
    const emp = await makeEmployee();
    const vacation = await makeVacationType(); // annualQuota: 10 days

    const r = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 99,
      via: 'reconcile',
    });
    expect(r).toEqual({ ok: false, error: 'insufficient-balance' });

    const rows = await auditRowsFor(emp.id, 0);
    expect(rows).toHaveLength(0);
  });
});

describe('setPenaltySettlement — refuses settlements payroll cannot charge', () => {
  it('refuses a Daily employee with unsupported-salary-type and writes no row (Defect 1)', async () => {
    // Payroll (calc.ts) only ever charges a money attendance penalty for
    // Monthly employees — a Daily employee's absence never becomes a money
    // charge in the first place, so settling it with leave would spend real
    // entitlement forgiving a penalty that was never going to happen.
    const emp = await makeEmployee({ salaryType: 'Daily' });
    const vacation = await makeVacationType();

    const r = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 1,
      via: 'reconcile',
    });
    expect(r).toEqual({ ok: false, error: 'unsupported-salary-type' });

    const rows = await prisma.attendancePenaltySettlement.findMany({
      where: { employeeId: emp.id },
    });
    expect(rows).toHaveLength(0);
  });

  it('refuses days exceeding the actual penalty with exceeds-penalty, and accepts days equal to it (Defect 2)', async () => {
    const emp = await makeEmployee();
    const vacation = await makeVacationType();
    await makeAbsence(emp.id); // exactly 1 actual Absent day this month

    const tooMany = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 2,
      via: 'reconcile',
    });
    expect(tooMany).toEqual({ ok: false, error: 'exceeds-penalty' });

    const rowsAfterRefusal = await prisma.attendancePenaltySettlement.findMany({
      where: { employeeId: emp.id, month: '2026-07', kind: 'Absent' },
    });
    expect(rowsAfterRefusal).toHaveLength(0);

    const exact = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 1,
      via: 'reconcile',
    });
    expect(exact).toEqual({ ok: true });
  });
});

describe('publishPayroll — blocks a stranded settlement (Defect 3)', () => {
  it('refuses to publish while a live settlement exceeds the actual penalty, names the employee, and succeeds once the settlement is cleared', async () => {
    const emp = await makeEmployee();
    const vacation = await makeVacationType();
    await makeAbsence(emp.id); // 1 actual Absent day, justifying the 1-day settlement below

    const settled = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 1,
      via: 'reconcile',
    });
    expect(settled).toEqual({ ok: true });

    // Strand it: void the attendance row after the leave was already spent —
    // the same shape as "an attendance row voided" or "an absence corrected"
    // (Defect 3's description). The settlement (and the leave it consumed)
    // is untouched; only the actual penalty disappears.
    await prisma.attendance.updateMany({
      where: { employeeId: emp.id },
      data: { deletedAt: new Date() },
    });

    await runPayrollDraft('2026-07');
    const blockedResult = await publishPayroll('2026-07', { employeeId: emp.id });

    expect(blockedResult.published).toHaveLength(0);
    expect(blockedResult.blocked).toEqual([
      { employeeId: emp.id, name: 'Test Worker', kind: 'Absent', actualDays: 0, settledDays: 1 },
    ]);

    // Nothing was written — the Draft row must still read Draft, not Published.
    const row = await prisma.payroll.findFirst({
      where: { employeeId: emp.id, month: '2026-07' },
    });
    expect(row?.status).toBe('Draft');

    // Clearing the stranded settlement is the fix the blocked result points
    // the admin toward — publish must then succeed.
    const cleared = await clearPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      via: 'reconcile',
    });
    expect(cleared).toEqual({ ok: true });

    const retryResult = await publishPayroll('2026-07', { employeeId: emp.id });
    expect(retryResult.blocked).toEqual([]);
    expect(retryResult.published).toHaveLength(1);
  });

  it('blocks the exact double-charge this guard exists to prevent: a LateThreeStrike settlement stranded by switching lateThreeStrikeEnabled off', async () => {
    // calc.ts:tier1LateMoney honours the settlement only in threeStrike mode
    // — flipping the rule off makes it charge the FULL flat lateDeduction per
    // late instead, while the settlement keeps its day of leave spent. Without
    // this guard the employee would pay in money AND leave for the same lates.
    const emp = await makeEmployee();
    const vacation = await makeVacationType();

    // 3 tier-1 lates = 1 threeStrikeDay under the default policy
    // (lateThreeStrikeEnabled: true, lateThreeStrikeCount: 3).
    await makeLate(emp.id, '2026-07-01', 10);
    await makeLate(emp.id, '2026-07-02', 10);
    await makeLate(emp.id, '2026-07-03', 10);

    const settled = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'LateThreeStrike',
      leaveTypeId: vacation.id,
      days: 1,
      via: 'reconcile',
    });
    expect(settled).toEqual({ ok: true });

    // Turn the three-strike rule off — the settlement is now stranded even
    // though the underlying lates never changed.
    await prisma.payrollConfig.updateMany({ data: { lateThreeStrikeEnabled: false } });

    await runPayrollDraft('2026-07');
    const result = await publishPayroll('2026-07', { employeeId: emp.id });

    expect(result.published).toHaveLength(0);
    expect(result.blocked).toEqual([
      {
        employeeId: emp.id,
        name: 'Test Worker',
        kind: 'LateThreeStrike',
        actualDays: 0,
        settledDays: 1,
      },
    ]);
  });
});

describe('setPenaltySettlement vs approveLeaveRequest (entitlement-lock race, Defect 1)', () => {
  it('never lets a concurrent settle and leave approval jointly overdraw the same (employee, type, year) balance', async () => {
    // Genuine race, not timing-dependent: both calls run truly concurrently
    // via Promise.all against real Postgres, so this test does not assert
    // which one "wins" — only that whichever wins, the combined outcome
    // never spends more than the 3-day (1,260-minute) grant.
    //
    // Without the entitlement lock (Defect 1's bug), both transactions read
    // the SAME pre-write balance before either commits (ReadCommitted):
    // approve sees used=0/penalty=0 → freezes NO over-quota deduction even
    // though 420 minutes were about to be spent settling a penalty, and
    // settle sees the same untouched 1,260-minute balance → both succeed.
    // Net effect: 1,260 (leave) + 420 (settlement) = 1,680 minutes spent
    // against a 1,260-minute grant, with the employee never charged a cent
    // for the 420-minute excess — exactly the "leave day AND the money"
    // double-jeopardy this feature exists to prevent, just inverted (here
    // it's an undetected shortfall instead of a shortfall payroll catches).
    const emp = await makeEmployee();
    // ลากิจ-shaped type: opted into penalty settlement, DeductPay policy
    // (the schema default) — approval is never blocked outright, so the
    // interesting assertion is on the frozen over-quota amount, not on
    // whether approval succeeds.
    const personal = await prisma.leaveType.create({
      data: {
        name: `ลากิจ-${uid().slice(0, 8)}`,
        annualQuota: 3, // 3 days × 420 std minutes = 1,260 minutes granted
        penaltySettlementAllowed: true,
      },
    });
    await makeAbsence(emp.id); // the actual 1-day penalty the settlement below settles

    const initial = await remainingByTypeForEmployee(emp.id, 2026);
    const std = initial[personal.id]! / 3;
    expect(std).toBe(420); // 09:00–12:00 + 13:00–17:00, the default LeaveConfig
    expect(initial[personal.id]).toBe(1260);

    // A 3-working-day FullDay request (Mon–Wed, no Sunday/holiday in the
    // range) that exactly exhausts the 1,260-minute grant on its own.
    const req = await prisma.leaveRequest.create({
      data: {
        employeeId: emp.id,
        leaveTypeId: personal.id,
        startDate: new Date('2026-07-13'),
        endDate: new Date('2026-07-15'),
        unit: 'FullDay',
        reason: 'ธุระส่วนตัว',
        status: 'Pending',
      },
    });

    const [settleResult, approveResult] = await Promise.all([
      setPenaltySettlement({
        employeeId: emp.id,
        month: '2026-07',
        kind: 'Absent',
        leaveTypeId: personal.id,
        days: 1, // 420 minutes
        via: 'reconcile',
      }),
      approveLeaveRequest({ leaveRequestId: req.id, note: 'อนุมัติ' }),
    ]);

    // DeductPay never refuses outright — only Block does — so whichever
    // order the lock resolves in, approval itself must succeed.
    expect(approveResult.ok).toBe(true);

    const updatedReq = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: req.id } });
    const settlementRow = await prisma.attendancePenaltySettlement.findUnique({
      where: {
        employeeId_month_kind: { employeeId: emp.id, month: '2026-07', kind: 'Absent' },
      },
    });
    const settlementLive = settlementRow && !settlementRow.deletedAt ? settlementRow : null;

    if (settleResult.ok) {
      // Settle committed first (holding the lock) — approve's re-read must
      // see the 420 minutes already spent and freeze EXACTLY that much as
      // over-quota (840 minutes of true headroom left against a 1,260-
      // minute request), not 0.
      expect(settlementLive).not.toBeNull();
      expect(updatedReq.chargedMinutes).toBe(1260);
      expect(updatedReq.overQuotaMinutes).toBe(420);
      expect(updatedReq.deductAmount).not.toBeNull();
      expect(Number(updatedReq.deductAmount)).toBeGreaterThan(0);
    } else {
      // Approve committed first, consuming the full 1,260-minute grant with
      // no leftover (chargedMinutes === the grant, so overQuota is 0/null)
      // — settle's re-read must then see zero headroom and be correctly
      // refused, never silently overdrawing.
      expect(settleResult).toEqual({ ok: false, error: 'insufficient-balance' });
      expect(settlementLive).toBeNull();
      expect(updatedReq.chargedMinutes).toBe(1260);
      expect(updatedReq.overQuotaMinutes).toBeNull();
    }

    // The invariant this test exists to prove, stated directly: a live
    // settlement (420 minutes spent) coexisting with a fully-charged
    // 1,260-minute request that recorded ZERO over-quota is exactly the
    // race bug — it means 1,680 minutes left a 1,260-minute grant with no
    // compensating deduction ever frozen. That combination must never occur.
    const bothSlippedThrough = settlementLive != null && (updatedReq.overQuotaMinutes ?? 0) === 0;
    expect(bothSlippedThrough).toBe(false);
  });
});

/** Bulk-create `n` bare Monthly employees sharing one branch, via two
 *  `createMany` round trips (explicit pre-generated ids correlate the User
 *  and Employee rows) instead of `n` sequential `makeEmployee()` calls. Used
 *  purely to pad `runPayrollDraft`'s per-employee write loop (see the race
 *  test below) — their own payroll numbers are never asserted on. */
async function makeFillerEmployees(n: number, branchId: string): Promise<void> {
  const userIds = Array.from({ length: n }, () => uid());
  await prisma.user.createMany({ data: userIds.map((id) => ({ id })) });
  await prisma.employee.createMany({
    data: userIds.map((userId, i) => ({
      userId,
      firstName: `Filler${i}`,
      lastName: 'Worker',
      branchId,
      salaryType: 'Monthly' as const,
      baseSalary: new Prisma.Decimal(20_000),
      status: 'Active' as const,
      hiredAt: new Date('2026-01-01'),
    })),
  });
}

describe('runPayrollDraft vs publishPayroll (month-lock race, Defect 2)', () => {
  it('never leaves a row that was Published back in Draft when a recalculation races a publish', async () => {
    // Genuine race, not a test that would pass either way — but also not one
    // where a single Promise.all reliably lands in the exact vulnerable
    // window. The unfixed `runPayrollDraft` reads ALL of the month's
    // existing rows ONCE up front, then writes them back one employee at a
    // time — the window where a concurrent `publishPayroll` can commit
    // AFTER that read but BEFORE this employee's specific write is only as
    // wide as "how many other employees does `runPayrollDraft` write before
    // reaching this one." 60 filler employees (created first, so they sort
    // before the target in `runPayrollDraft`'s unordered scan) pad that
    // window, but empirically (checked while writing this test, against the
    // pre-fix code) a single race attempt still only lands in the window
    // roughly half the time — real wall-clock scheduling, not a lock, is
    // doing the synchronizing on the unfixed side. So this test repeats the
    // race 10 times against the SAME padded pool and asserts the invariant
    // after every single one: with the fix, the shared month lock makes
    // each iteration serialize deterministically (this must pass 10/10,
    // every time, forever); without it, a real bug needs to slip through
    // undetected in all 10 independent attempts to hide — chained across a
    // ~50%-per-attempt window, roughly a 1-in-1,000 chance, which is what
    // "reliably catches the pre-fix bug" means for a genuine timing race
    // rather than a lock-mediated one (contrast the sibling settle-vs-
    // publish tests above, which lock on both sides and so only need one
    // attempt). This branch's setReconcileSettlement/clearReconcileSettlement
    // (admin/payroll/reconcile/actions.ts) call runPayrollDraft immediately
    // after a settlement commits, OUTSIDE any lock of their own — the shape
    // this race takes in production, reproduced here directly against
    // runPayrollDraft/publishPayroll rather than through those thin wrappers.
    const branch = await prisma.branch.create({ data: { name: `Branch-${uid().slice(0, 8)}` } });
    await makeFillerEmployees(60, branch.id);

    for (let attempt = 0; attempt < 10; attempt++) {
      const emp = await makeEmployee();

      await runPayrollDraft('2026-07');
      const draftBefore = await prisma.payroll.findFirstOrThrow({
        where: { employeeId: emp.id, month: '2026-07' },
      });
      expect(draftBefore.status).toBe('Draft');

      const [, publishResult] = await Promise.all([
        runPayrollDraft('2026-07'),
        publishPayroll('2026-07', { employeeId: emp.id }),
      ]);

      expect(publishResult.blocked).toEqual([]);
      expect(publishResult.published).toHaveLength(1);

      const after = await prisma.payroll.findFirstOrThrow({
        where: { employeeId: emp.id, month: '2026-07' },
      });
      // The one invariant this test exists to prove: whichever of the two
      // concurrent calls' writes landed last, a row that reached Published
      // must never read Draft afterward.
      expect(after.status).toBe('Published');
      expect(after.publishedAt).not.toBeNull();
    }
  });
});

/**
 * Mutation-testing gap closure (see fix-testgaps-report.md).
 *
 * `approveLeaveRequest` (leave/admin.ts ~L283) reads `penaltyMinutes` and
 * folds it into `remaining` before deciding two things: whether a `Block`
 * leave type refuses the request, and how large a `DeductPay` type's frozen
 * `deductAmount` is. A mutation that neutered the `penaltyMinutes` call
 * (`0 * (await penaltyMinutes(...))`) survived the whole suite because no
 * test ever settled a penalty against the SAME leave type before approving —
 * every prior test either had no settlement, or settled a different
 * (employee, type) pair. Both tests below settle a penalty against the exact
 * type being approved, so the two halves of that call site's decision only
 * come out right if the real (non-zero) penalty was actually subtracted.
 */
describe('approveLeaveRequest — folds settled penalty minutes into the over-quota decision', () => {
  it('Block: refuses leave the employee no longer has once a penalty settlement consumed the entitlement that would have covered it', async () => {
    const emp = await makeEmployee();
    const vacation = await prisma.leaveType.create({
      data: {
        name: `ลาพักร้อน-block-${uid().slice(0, 8)}`,
        annualQuota: 1, // 1 day = 420 minutes granted — exactly enough for the request below
        overQuotaPolicy: 'Block',
        penaltySettlementAllowed: true,
      },
    });
    await makeAbsence(emp.id); // the actual 1-day penalty the settlement below settles

    const settled = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 1, // spends the entire 420-minute grant, leaving 0 remaining
      via: 'reconcile',
    });
    expect(settled).toEqual({ ok: true });

    // A single-working-day FullDay request for the (now fully consumed)
    // entitlement. With the real penalty subtracted, remaining is 0 and this
    // 420-minute request is entirely over-quota — Block must refuse it. If
    // the call site instead saw penalty=0 (the mutation), remaining would
    // read back as the full untouched 420 minutes and the request would be
    // wrongly approved against leave that was already spent settling the
    // absence.
    const req = await prisma.leaveRequest.create({
      data: {
        employeeId: emp.id,
        leaveTypeId: vacation.id,
        startDate: new Date('2026-07-13'), // Monday, no holiday
        endDate: new Date('2026-07-13'),
        unit: 'FullDay',
        reason: 'ลาพักร้อน',
        status: 'Pending',
      },
    });

    const result = await approveLeaveRequest({ leaveRequestId: req.id, note: 'ตรวจสอบแล้ว' });
    expect(result).toMatchObject({ ok: false, code: 'over-quota-block' });

    // Nothing was written — the request must still read Pending, not Approved.
    const after = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(after.status).toBe('Pending');
    expect(after.deductAmount).toBeNull();
  });

  it('DeductPay: freezes the correct over-quota deduction once a penalty settlement has consumed part of the entitlement', async () => {
    const emp = await makeEmployee(); // Monthly, ฿20,000, workingDaysPerMonth 30
    const personal = await prisma.leaveType.create({
      data: {
        name: `ลากิจ-deduct-${uid().slice(0, 8)}`,
        annualQuota: 2, // 2 days = 840 minutes granted
        // overQuotaPolicy defaults to DeductPay (schema default) — deliberately not set.
        penaltySettlementAllowed: true,
      },
    });
    await makeAbsence(emp.id); // the actual 1-day penalty the settlement below settles

    const settled = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: personal.id,
      days: 1, // spends 420 of the 840 minutes, leaving 420 remaining
      via: 'reconcile',
    });
    expect(settled).toEqual({ ok: true });

    // A 2-working-day FullDay request (Mon–Tue) charging the full 840-minute
    // grant. Against the penalty-reduced 420-minute remaining balance, 420
    // minutes are over-quota; at this employee's rate (20000/30/420 ฿/min)
    // that is exactly the familiar ฿666.67 one-day charge used elsewhere in
    // this file. If the call site instead saw penalty=0, remaining would
    // read back as the full 840 minutes, the request would exactly fit, and
    // deductAmount would freeze as null — no money charged for leave the
    // employee did not actually have.
    const req = await prisma.leaveRequest.create({
      data: {
        employeeId: emp.id,
        leaveTypeId: personal.id,
        startDate: new Date('2026-07-13'), // Monday
        endDate: new Date('2026-07-14'), // Tuesday — 2 working days, no Sunday between
        unit: 'FullDay',
        reason: 'ธุระส่วนตัว',
        status: 'Pending',
      },
    });

    const result = await approveLeaveRequest({ leaveRequestId: req.id, note: 'อนุมัติ' });
    expect(result).toMatchObject({ ok: true });

    const after = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(after.chargedMinutes).toBe(840);
    expect(after.overQuotaMinutes).toBe(420);
    expect(after.deductAmount).not.toBeNull();
    expect(Number(after.deductAmount)).toBe(666.67);
  });
});

/**
 * Mutation-testing gap closure: the other three `remainingMinutes` call
 * sites in leave/balance.ts and leave/approval-preview.ts. Each test settles
 * a 1-day (420-minute) penalty and asserts the function's OWN return value
 * moves by exactly that amount — not merely that the call succeeds — so a
 * neutered `penaltyMinutes` call at that specific site goes red.
 */
describe('the other remaining-balance call sites also fold in settled penalty minutes', () => {
  it('getOrSeedEntitlements (admin entitlement table) reports 420 fewer remaining minutes once a penalty is settled', async () => {
    const emp = await makeEmployee();
    const vacation = await makeVacationType(); // annualQuota: 10 days
    await makeAbsence(emp.id);

    const before = await getOrSeedEntitlements(emp.id, 2026);
    const beforeRow = before.find((r) => r.leaveTypeId === vacation.id);
    expect(beforeRow?.remainingMinutes).not.toBeNull();

    const settled = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 1,
      via: 'reconcile',
    });
    expect(settled).toEqual({ ok: true });

    const after = await getOrSeedEntitlements(emp.id, 2026);
    const afterRow = after.find((r) => r.leaveTypeId === vacation.id);
    expect(afterRow?.remainingMinutes).toBe(beforeRow!.remainingMinutes! - 420);
  });

  it('remainingByTypeForEmployees (bulk report surface) reports 420 fewer remaining minutes once a penalty is settled', async () => {
    const emp = await makeEmployee();
    const vacation = await makeVacationType();
    await makeAbsence(emp.id);

    const before = await remainingByTypeForEmployees([emp.id], 2026);
    const beforeRemaining = before[emp.id]?.[vacation.id];
    expect(beforeRemaining).not.toBeNull();

    const settled = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 1,
      via: 'reconcile',
    });
    expect(settled).toEqual({ ok: true });

    const after = await remainingByTypeForEmployees([emp.id], 2026);
    const afterRemaining = after[emp.id]?.[vacation.id];
    expect(afterRemaining).toBe(beforeRemaining! - 420);
  });

  it('overQuotaPreview (worker-facing preview) charges an over-quota deduction once a penalty settlement has consumed the entitlement it previews against', async () => {
    const emp = await makeEmployee(); // Monthly, ฿20,000, workingDaysPerMonth 30
    const personal = await prisma.leaveType.create({
      data: {
        name: `ลากิจ-preview-${uid().slice(0, 8)}`,
        annualQuota: 2, // 840 minutes granted
        penaltySettlementAllowed: true,
      },
    });
    await makeAbsence(emp.id);

    // Preview charging the FULL 840-minute grant, before anything is settled:
    // fits exactly, no over-quota.
    const before = await overQuotaPreview(emp.id, personal.id, 2026, 840);
    expect(before.remaining).toBe(840);
    expect(before.overQuotaMinutes).toBe(0);
    expect(before.estimatedDeduction).toBe(0);

    const settled = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: personal.id,
      days: 1, // spends 420 of the 840 minutes
      via: 'reconcile',
    });
    expect(settled).toEqual({ ok: true });

    // Same 840-minute preview, now against a penalty-reduced 420-minute
    // balance: 420 minutes over-quota, ฿666.67 estimated (same known
    // one-day figure as the DeductPay freeze test above).
    const after = await overQuotaPreview(emp.id, personal.id, 2026, 840);
    expect(after.remaining).toBe(420);
    expect(after.overQuotaMinutes).toBe(420);
    expect(after.estimatedDeduction).toBe(666.67);
  });
});

/**
 * Mutation-testing gap closure: calc.ts's `lateTier1.days` and
 * `lateSevere.days` must stay GROSS (what happened) even once a penalty of
 * that kind has been settled — `moneyDaysFor` nets the MONEY side
 * separately. `actualDaysFromAttendance` (reconcile-settlement.ts) reads
 * these `days` fields directly to decide both whether an edit to an existing
 * settlement "exceeds the penalty" and whether publish should block a
 * "stranded settlement". If either field were netted instead of gross, an
 * edit to a fully-settled SevereLate/LateThreeStrike penalty would falsely
 * refuse as `exceeds-penalty`, and publishing the month would falsely block
 * as stranded — even though nothing about the underlying attendance ever
 * changed. Every pre-existing edit/publish test in this file uses
 * `kind: 'Absent'` (whose `actual.count` is never netted in the first
 * place), so this gap was invisible to the whole suite.
 */
describe('setPenaltySettlement/publishPayroll — SevereLate and LateThreeStrike stay editable and publishable once fully settled', () => {
  it('SevereLate: an edit from 1 to 2 days succeeds, and publish is not blocked, once both severe lates are fully settled', async () => {
    const emp = await makeEmployee();
    const vacation = await makeVacationType();
    // Two severe lates (> the default 30-min threshold) on separate dates —
    // gross lateSevere.days = 2.
    await makeLate(emp.id, '2026-07-01', 45);
    await makeLate(emp.id, '2026-07-02', 45);

    const first = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'SevereLate',
      leaveTypeId: vacation.id,
      days: 1,
      via: 'reconcile',
    });
    expect(first).toEqual({ ok: true });

    // The edit: raising 1 day to 2. `exceeds-penalty` re-reads the actual
    // days against the CURRENT settled amount (1) — if `lateSevere.days`
    // were netted (2 gross − 1 settled = 1) instead of staying gross (2),
    // this edit would be wrongly refused as exceeding a penalty that in
    // reality still has 2 actual days behind it.
    const edited = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'SevereLate',
      leaveTypeId: vacation.id,
      days: 2,
      via: 'reconcile',
    });
    expect(edited).toEqual({ ok: true });

    await runPayrollDraft('2026-07');
    const result = await publishPayroll('2026-07', { employeeId: emp.id });

    // Fully settled (2 actual, 2 settled): if `lateSevere.days` were netted
    // to 0 (2 gross − 2 settled), publish would wrongly see 0 actual days
    // against 2 settled days and block as a stranded settlement.
    expect(result.blocked).toEqual([]);
    expect(result.published).toHaveLength(1);
  });

  it('LateThreeStrike (three-strike mode): an edit from 1 to 2 days succeeds, and publish is not blocked, once both strikes are fully settled', async () => {
    const emp = await makeEmployee();
    const vacation = await makeVacationType();
    // 6 tier-1 lates (<= the default 30-min threshold) = 2 three-strike days
    // under the default policy (lateThreeStrikeEnabled: true, count: 3).
    await makeLate(emp.id, '2026-07-01', 10);
    await makeLate(emp.id, '2026-07-02', 10);
    await makeLate(emp.id, '2026-07-03', 10);
    await makeLate(emp.id, '2026-07-04', 10);
    await makeLate(emp.id, '2026-07-05', 10);
    await makeLate(emp.id, '2026-07-06', 10);

    const first = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'LateThreeStrike',
      leaveTypeId: vacation.id,
      days: 1,
      via: 'reconcile',
    });
    expect(first).toEqual({ ok: true });

    // Same shape as the SevereLate edit above: if `lateTier1.days` were
    // netted against the currently-settled 1 day instead of staying gross
    // (2), this edit to 2 would be wrongly refused as exceeds-penalty.
    const edited = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'LateThreeStrike',
      leaveTypeId: vacation.id,
      days: 2,
      via: 'reconcile',
    });
    expect(edited).toEqual({ ok: true });

    await runPayrollDraft('2026-07');
    const result = await publishPayroll('2026-07', { employeeId: emp.id });

    // Fully settled (2 actual, 2 settled): a netted `lateTier1.days` (2
    // gross − 2 settled = 0) would make publish wrongly see this as a
    // stranded settlement.
    expect(result.blocked).toEqual([]);
    expect(result.published).toHaveLength(1);
  });
});
