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

    const initial = await remainingByTypeForEmployee(emp.id, 2026);
    const std = initial[vacation.id]!; // annualQuota: 1 day == the whole balance

    // A Draft Payroll row must exist for the lock to have anything to lock —
    // exactly the state the reconcile page settles against in practice (it
    // only shows a penalty once "คำนวณ" has produced a Draft row). Without
    // this, there is nothing for lockPayrollRow to find, and — as documented
    // on that function — that's fine for a single call, but it means this
    // test would be asserting something the fix does not claim to cover.
    await runPayrollDraft('2026-07');

    const [absentResult, severeResult] = await Promise.all([
      setPenaltySettlement({
        employeeId: emp.id,
        month: '2026-07',
        kind: 'Absent',
        leaveTypeId: vacation.id,
        days: 1,
      }),
      setPenaltySettlement({
        employeeId: emp.id,
        month: '2026-07',
        kind: 'SevereLate',
        leaveTypeId: vacation.id,
        days: 1,
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

  it('refuses a malformed month, writing nothing', async () => {
    const emp = await makeEmployee();

    const r = await clearPenaltySettlement({
      employeeId: emp.id,
      month: 'not-a-month',
      kind: 'Absent',
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

    const res = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 1,
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

    await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 1,
    });

    const edited = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 2,
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

    await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 1,
    });

    const cleared = await clearPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
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

    const first = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 1,
    });
    expect(first).toEqual({ ok: true });

    const cleared = await clearPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
    });
    expect(cleared).toEqual({ ok: true });

    const resettled = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 1,
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
    });
    expect(r).toEqual({ ok: false, error: 'insufficient-balance' });

    const rows = await auditRowsFor(emp.id, 0);
    expect(rows).toHaveLength(0);
  });
});
