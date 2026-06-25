import { Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import {
  lockPayroll,
  previewPayrollDrafts,
  publishPayroll,
  runPayrollDraft,
} from '@/lib/payroll/run';

/**
 * Integration tests for the payroll run/publish pipeline against the dedicated
 * `koolman_test` database. Covers the parts the pure calc.test.ts can't: input
 * GATHERING, Draft persistence, and the publish-time SWEEPS (advance/leave
 * stamping, recurring-deduction decrement) — plus the freeze/idempotency rules.
 */

const MONTH = '2026-06';
const inMonth = new Date('2026-06-15T00:00:00.000Z');

function uid(): string {
  return crypto.randomUUID();
}

/** Wipe transactional tables (dedicated DB) and re-seed the required singletons. */
async function reset() {
  await prisma.payroll.deleteMany({});
  await prisma.overtimeEntry.deleteMany({});
  await prisma.attendance.deleteMany({});
  await prisma.cashAdvance.deleteMany({});
  await prisma.recurringDeduction.deleteMany({});
  await prisma.payrollAdjustment.deleteMany({});
  await prisma.leaveRequest.deleteMany({});
  await prisma.leaveEntitlement.deleteMany({});
  await prisma.employee.deleteMany({});
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
}

async function makeEmployee(opts: { baseSalary: number; hasSso?: boolean }) {
  const user = await prisma.user.create({ data: {} });
  const branch = await prisma.branch.create({ data: { name: `Branch-${uid().slice(0, 8)}` } });
  return prisma.employee.create({
    data: {
      userId: user.id,
      firstName: 'Test',
      lastName: 'Worker',
      branchId: branch.id,
      salaryType: 'Monthly',
      baseSalary: new Prisma.Decimal(opts.baseSalary),
      hasSso: opts.hasSso ?? false,
      status: 'Active',
      hiredAt: new Date('2026-01-01'),
    },
  });
}

beforeEach(reset);
afterAll(async () => {
  await prisma.$disconnect();
});

describe('runPayrollDraft', () => {
  it('gathers inputs and computes the deduction buckets', async () => {
    const emp = await makeEmployee({ baseSalary: 20_000 });
    await prisma.cashAdvance.create({
      data: { employeeId: emp.id, amount: new Prisma.Decimal(3_000), status: 'Approved' },
    });
    await prisma.attendance.create({
      data: {
        employeeId: emp.id,
        date: inMonth,
        type: 'Absent',
        source: 'Manual',
        createdById: uid(),
      },
    });

    const res = await runPayrollDraft(MONTH);
    expect(res.calculated).toBe(1);

    const row = await prisma.payroll.findFirstOrThrow({
      where: { employeeId: emp.id, month: MONTH },
    });
    expect(row.status).toBe('Draft');
    expect(Number(row.incomeBase)).toBe(20_000);
    expect(Number(row.deductAdvance)).toBe(3_000);
    expect(Number(row.deductAttendance)).toBe(500); // 1 absent × ฿500
    expect(Number(row.deductSso)).toBe(0); // hasSso false
    expect(Number(row.netPay)).toBe(16_500); // 20000 − 3000 − 500
  });

  it('windows attendance by the payroll cutoff, not the calendar month (C8)', async () => {
    // cutoff 26 → the 2026-06 period is 2026-05-27 .. 2026-06-26 (inclusive).
    await prisma.payrollConfig.updateMany({ data: { cutoffDay: 26 } });
    const emp = await makeEmployee({ baseSalary: 20_000 });
    const absent = (ymd: string) =>
      prisma.attendance.create({
        data: {
          employeeId: emp.id,
          date: new Date(`${ymd}T00:00:00.000Z`),
          type: 'Absent',
          source: 'Manual',
          createdById: uid(),
        },
      });
    await absent('2026-05-27'); // first day of window → counts
    await absent('2026-06-26'); // cutoff day, inclusive → counts
    await absent('2026-05-26'); // day before window → excluded (prev period)
    await absent('2026-06-27'); // day after cutoff → excluded (next period)

    await runPayrollDraft(MONTH);
    const row = await prisma.payroll.findFirstOrThrow({
      where: { employeeId: emp.id, month: MONTH },
    });
    expect(Number(row.deductAttendance)).toBe(1_000); // only the 2 in-window absents × ฿500
  });

  // ── Late penalties (C9) — defaults from reset()'s config: 3-strike on,
  // severe on (>30 min). Window for 2026-06 @ cutoff 25 = 2026-05-26..06-25.
  const lateRow = (employeeId: string, ymd: string, minutes: number) =>
    prisma.attendance.create({
      data: {
        employeeId,
        date: new Date(`${ymd}T00:00:00.000Z`),
        type: 'Late',
        source: 'Manual',
        durationMinutes: minutes,
        createdById: uid(),
      },
    });

  it('charges one absent-day per N ordinary lates (C9 three-strike replaces flat)', async () => {
    const emp = await makeEmployee({ baseSalary: 20_000 });
    await lateRow(emp.id, '2026-06-10', 10);
    await lateRow(emp.id, '2026-06-11', 12);
    await lateRow(emp.id, '2026-06-12', 8); // 3 ordinary lates → 1 day
    await runPayrollDraft(MONTH);
    const row = await prisma.payroll.findFirstOrThrow({
      where: { employeeId: emp.id, month: MONTH },
    });
    expect(Number(row.deductAttendance)).toBe(500); // 1 day, not 3 × ฿100 flat
  });

  it('charges one absent-day for a severe late with no leave that day (C9)', async () => {
    const emp = await makeEmployee({ baseSalary: 20_000 });
    await lateRow(emp.id, '2026-06-15', 45); // > 30 min → severe
    await runPayrollDraft(MONTH);
    const row = await prisma.payroll.findFirstOrThrow({
      where: { employeeId: emp.id, month: MONTH },
    });
    expect(Number(row.deductAttendance)).toBe(500);
  });

  it('exempts a severe late when the employee had approved leave that day (C9)', async () => {
    const emp = await makeEmployee({ baseSalary: 20_000 });
    const lt = await prisma.leaveType.create({
      data: { name: `ลากิจ-${uid().slice(0, 8)}`, annualQuota: 10 },
    });
    await lateRow(emp.id, '2026-06-15', 45); // severe…
    await prisma.leaveRequest.create({
      data: {
        employeeId: emp.id,
        leaveTypeId: lt.id,
        startDate: new Date('2026-06-15T00:00:00.000Z'),
        endDate: new Date('2026-06-15T00:00:00.000Z'),
        reason: 'personal',
        status: 'Approved',
      },
    });
    await runPayrollDraft(MONTH);
    const row = await prisma.payroll.findFirstOrThrow({
      where: { employeeId: emp.id, month: MONTH },
    });
    expect(Number(row.deductAttendance)).toBe(0); // …but exempt — leave covers the day
  });
});

describe('publishPayroll', () => {
  it('stamps swept advances/leave and decrements recurring deductions', async () => {
    const emp = await makeEmployee({ baseSalary: 20_000, hasSso: true });
    const advance = await prisma.cashAdvance.create({
      data: { employeeId: emp.id, amount: new Prisma.Decimal(3_000), status: 'Approved' },
    });
    const recurring = await prisma.recurringDeduction.create({
      data: {
        employeeId: emp.id,
        reason: 'loan',
        monthlyAmount: new Prisma.Decimal(1_000),
        monthsRemaining: 2,
      },
    });
    // Leave deduction is DERIVED, not a stored flat amount: a DeductPay leave
    // with a zero entitlement → the whole charged day is over quota. rate =
    // 20000/30/420 = 1.5873/min, so 420 over-quota min = ฿666.67 (one day's pay).
    const leaveType = await prisma.leaveType.create({
      data: { name: `LT-${uid().slice(0, 8)}`, overQuotaPolicy: 'DeductPay', annualQuota: 3 },
    });
    await prisma.leaveEntitlement.create({
      data: {
        employeeId: emp.id,
        leaveTypeId: leaveType.id,
        periodYear: 2026,
        grantedMinutes: 0,
        carryoverMinutes: 0,
        adjustmentMinutes: 0,
      },
    });
    const leave = await prisma.leaveRequest.create({
      data: {
        employeeId: emp.id,
        leaveTypeId: leaveType.id,
        startDate: inMonth,
        endDate: inMonth,
        reason: 'over quota',
        status: 'Approved',
        // The frozen snapshot is deliberately STALE (over 0 / no deduct) to prove
        // the draft derives the deduction live and publish freezes the live value.
        chargedMinutes: 420,
        overQuotaMinutes: 0,
        deductAmount: null,
      },
    });

    await runPayrollDraft(MONTH);
    const res = await publishPayroll(MONTH);
    expect(res.published).toHaveLength(1);

    const row = await prisma.payroll.findFirstOrThrow({
      where: { employeeId: emp.id, month: MONTH },
    });
    expect(row.status).toBe('Published');
    expect(row.publishedAt).not.toBeNull();
    expect(Number(row.deductSso)).toBe(750); // 5% of capped 15,000
    expect(Number(row.deductAdvance)).toBe(3_000);
    expect(Number(row.deductDebt)).toBe(1_000);
    expect(Number(row.deductLeave)).toBe(666.67); // derived live, not the stale snapshot
    expect(Number(row.netPay)).toBe(14_583.33); // 20000 − 750 − 3000 − 1000 − 666.67

    // Sweeps stamped.
    const adv = await prisma.cashAdvance.findUniqueOrThrow({ where: { id: advance.id } });
    expect(adv.isDeducted).toBe(true);
    expect(adv.deductedInPayrollId).toBe(row.id);

    const rec = await prisma.recurringDeduction.findUniqueOrThrow({ where: { id: recurring.id } });
    expect(rec.monthsRemaining).toBe(1);
    expect(rec.endedAt).toBeNull();

    // Leave stamped AND the live value FROZEN onto the row (it must never move
    // again once paid, even if the entitlement is later edited).
    const lv = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: leave.id } });
    expect(lv.deductedInPayrollId).toBe(row.id);
    expect(lv.overQuotaMinutes).toBe(420);
    expect(Number(lv.deductAmount)).toBe(666.67);
  });

  it('derives leave deduction live from the entitlement, then freezes it at publish', async () => {
    // The whole point of derive-on-read: editing an entitlement must change the
    // NEXT draft with zero manual recompute, and publishing must freeze the
    // value so a later entitlement edit can never move a paid payroll.
    const emp = await makeEmployee({ baseSalary: 20_000 });
    const leaveType = await prisma.leaveType.create({
      data: { name: `LT-${uid().slice(0, 8)}`, overQuotaPolicy: 'DeductPay', annualQuota: 3 },
    });
    // Start fully within quota (1 granted day vs a 1-day leave) → no deduction.
    const ent = await prisma.leaveEntitlement.create({
      data: {
        employeeId: emp.id,
        leaveTypeId: leaveType.id,
        periodYear: 2026,
        grantedMinutes: 420,
        carryoverMinutes: 0,
        adjustmentMinutes: 0,
      },
    });
    await prisma.leaveRequest.create({
      data: {
        employeeId: emp.id,
        leaveTypeId: leaveType.id,
        startDate: inMonth,
        endDate: inMonth,
        reason: 'leave',
        status: 'Approved',
        chargedMinutes: 420,
      },
    });

    await runPayrollDraft(MONTH);
    let row = await prisma.payroll.findFirstOrThrow({
      where: { employeeId: emp.id, month: MONTH },
    });
    expect(Number(row.deductLeave)).toBe(0); // within quota

    // Shrink the entitlement to zero — NO recompute tool is run.
    await prisma.leaveEntitlement.update({ where: { id: ent.id }, data: { grantedMinutes: 0 } });

    await runPayrollDraft(MONTH); // draft re-derives live
    row = await prisma.payroll.findFirstOrThrow({ where: { employeeId: emp.id, month: MONTH } });
    expect(Number(row.deductLeave)).toBe(666.67); // now fully over quota — no manual step

    await publishPayroll(MONTH); // freezes the live value onto the leave + payroll

    // Grow the entitlement back AFTER publish — the paid payroll must not move.
    await prisma.leaveEntitlement.update({ where: { id: ent.id }, data: { grantedMinutes: 420 } });
    const res = await runPayrollDraft(MONTH);
    expect(res.frozen).toBe(1);
    expect(res.calculated).toBe(0);
    row = await prisma.payroll.findFirstOrThrow({ where: { employeeId: emp.id, month: MONTH } });
    expect(Number(row.deductLeave)).toBe(666.67); // frozen, even though quota now covers it
  });

  it('is idempotent — re-publishing does not double-sweep', async () => {
    const emp = await makeEmployee({ baseSalary: 20_000 });
    const recurring = await prisma.recurringDeduction.create({
      data: {
        employeeId: emp.id,
        reason: 'loan',
        monthlyAmount: new Prisma.Decimal(1_000),
        monthsRemaining: 2,
      },
    });

    await runPayrollDraft(MONTH);
    await publishPayroll(MONTH);
    const after1 = await prisma.recurringDeduction.findUniqueOrThrow({
      where: { id: recurring.id },
    });
    expect(after1.monthsRemaining).toBe(1);

    // Second publish: the row is already Published → skipped, no second decrement.
    const res2 = await publishPayroll(MONTH);
    expect(res2.published).toHaveLength(0);
    const after2 = await prisma.recurringDeduction.findUniqueOrThrow({
      where: { id: recurring.id },
    });
    expect(after2.monthsRemaining).toBe(1);
    expect(await prisma.payroll.count({ where: { employeeId: emp.id, month: MONTH } })).toBe(1);
  });

  it('leaves Published rows frozen on a later draft recalculation', async () => {
    const emp = await makeEmployee({ baseSalary: 20_000 });
    await runPayrollDraft(MONTH);
    await publishPayroll(MONTH);

    const res = await runPayrollDraft(MONTH);
    expect(res.frozen).toBe(1);
    expect(res.calculated).toBe(0);
    const row = await prisma.payroll.findFirstOrThrow({
      where: { employeeId: emp.id, month: MONTH },
    });
    expect(row.status).toBe('Published'); // not reverted to Draft
  });
});

describe('lockPayroll', () => {
  it('flips Published rows to Locked', async () => {
    await makeEmployee({ baseSalary: 20_000 });
    await runPayrollDraft(MONTH);
    await publishPayroll(MONTH);

    const locked = await lockPayroll(MONTH);
    expect(locked).toBe(1);
    const rows = await prisma.payroll.findMany({ where: { month: MONTH } });
    expect(rows.every((r) => r.status === 'Locked')).toBe(true);
  });
});

describe('previewPayrollDrafts (stale-draft detection)', () => {
  it('recomputes a fresh draft that differs once inputs change after คำนวณ', async () => {
    const emp = await makeEmployee({ baseSalary: 20_000 });
    await runPayrollDraft(MONTH); // draft with no deductions

    const stored = await prisma.payroll.findFirstOrThrow({
      where: { employeeId: emp.id, month: MONTH },
    });
    expect(Number(stored.deductAdvance)).toBe(0);

    // An advance is approved AFTER the draft was calculated.
    await prisma.cashAdvance.create({
      data: { employeeId: emp.id, amount: new Prisma.Decimal(2_000), status: 'Approved' },
    });

    const fresh = await previewPayrollDrafts(MONTH);
    const f = fresh.get(emp.id);
    expect(f).toBeDefined();
    // Fresh recompute reflects the new advance → differs from the stored draft (stale).
    expect(Number(f?.deductAdvance)).toBe(2_000);
    expect(Number(f?.deductAdvance)).not.toBe(Number(stored.deductAdvance));
  });
});
