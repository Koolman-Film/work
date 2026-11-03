import { Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import {
  addBranchCutoff,
  branchMoveBlockedByPaidMonth,
  removeBranchCutoff,
} from '@/lib/payroll/branch-cutoff-admin';
import { END_OF_MONTH } from '@/lib/payroll/cutoff-rule';
import { publishPayroll, runPayrollDraft } from '@/lib/payroll/run';

/**
 * Central Audio cuts at month-end from the 2026-10 payroll month; every other
 * branch keeps the company day (26). One run of "2026-10" therefore covers two
 * windows: Central 27 Sep – 31 Oct, everyone else 27 Sep – 26 Oct.
 */

const COMPANY_CUTOFF = 26;

async function reset() {
  await prisma.payroll.deleteMany({});
  await prisma.cashAdvance.deleteMany({});
  await prisma.attendance.deleteMany({});
  await prisma.branchPayrollCutoff.deleteMany({});
  await prisma.employee.deleteMany({});
  await prisma.branch.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.payrollConfig.deleteMany({});
  await prisma.payrollConfig.create({
    data: {
      ssoRate: new Prisma.Decimal('0.05'),
      ssoSalaryCap: new Prisma.Decimal(15_000),
      ssoAmountCap: new Prisma.Decimal(750),
      otMultiplier: new Prisma.Decimal('1.5'),
      absentDeductionPerDay: new Prisma.Decimal(500),
      lateDeduction: new Prisma.Decimal(100),
      earlyLeaveDeduction: new Prisma.Decimal(100),
      workingDaysPerMonth: 30,
      cutoffDay: COMPANY_CUTOFF,
      // One late = ฿100, no strike/severe interplay.
      lateThreeStrikeEnabled: false,
      severeLateEnabled: false,
    },
  });
}

async function makeEmployee(branchName: string) {
  const user = await prisma.user.create({ data: {} });
  const branch = await prisma.branch.create({ data: { name: branchName } });
  const emp = await prisma.employee.create({
    data: {
      userId: user.id,
      firstName: branchName,
      lastName: 'Test',
      branchId: branch.id,
      salaryType: 'Monthly',
      baseSalary: new Prisma.Decimal(20_000),
      hasSso: false,
      allowanceAmount: new Prisma.Decimal(0),
      status: 'Active',
      hiredAt: new Date('2026-01-01'),
    },
  });
  return { emp, branch, user };
}

async function late(employeeId: string, ymd: string, createdById: string) {
  await prisma.attendance.create({
    data: {
      employeeId,
      date: new Date(`${ymd}T00:00:00.000Z`),
      type: 'Late',
      source: 'Manual',
      createdById,
    },
  });
}

async function payrollFor(employeeId: string, month: string) {
  return prisma.payroll.findUniqueOrThrow({
    where: { employeeId_month: { employeeId, month } },
  });
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe('per-branch payroll cut-off', () => {
  beforeEach(reset);

  it('DEPLOY SAFETY: with no override every branch keeps the company window', async () => {
    const central = await makeEmployee('Central Audio');
    await late(central.emp.id, '2026-10-30', central.user.id);
    await runPayrollDraft('2026-10');
    expect(Number((await payrollFor(central.emp.id, '2026-10')).deductAttendance)).toBe(0);
  });

  it('one 2026-10 run charges Central through 31 Oct and everyone else through 26 Oct', async () => {
    const central = await makeEmployee('Central Audio');
    const cm = await makeEmployee('เชียงใหม่');
    expect(
      await addBranchCutoff({
        branchId: central.branch.id,
        fromMonth: '2026-10',
        cutoffDay: END_OF_MONTH,
        actorId: central.user.id,
      }),
    ).toEqual({ ok: true });

    for (const e of [central, cm]) {
      await late(e.emp.id, '2026-09-28', e.user.id); // both windows
      await late(e.emp.id, '2026-10-30', e.user.id); // Central's only
      await prisma.cashAdvance.create({
        data: {
          employeeId: e.emp.id,
          amount: new Prisma.Decimal(1_000),
          status: 'Approved',
          // 29 Oct 10:00 Bangkok.
          requestedAt: new Date('2026-10-29T03:00:00.000Z'),
        },
      });
    }

    await runPayrollDraft('2026-10');
    const c = await payrollFor(central.emp.id, '2026-10');
    const m = await payrollFor(cm.emp.id, '2026-10');
    expect(Number(c.deductAttendance)).toBe(200);
    expect(Number(c.deductAdvance)).toBe(1_000);
    expect(Number(m.deductAttendance)).toBe(100);
    expect(Number(m.deductAdvance)).toBe(0);

    // The 30 Oct late lands on เชียงใหม่'s November, not on Central's.
    await runPayrollDraft('2026-11');
    expect(Number((await payrollFor(cm.emp.id, '2026-11')).deductAttendance)).toBe(100);
    expect(Number((await payrollFor(central.emp.id, '2026-11')).deductAttendance)).toBe(0);
  });

  it('refuses an override that would re-window a published payslip', async () => {
    const central = await makeEmployee('Central Audio');
    await runPayrollDraft('2026-10');
    await prisma.payroll.updateMany({
      where: { employeeId: central.emp.id, month: '2026-10' },
      data: { status: 'Published', publishedAt: new Date() },
    });

    const args = { branchId: central.branch.id, cutoffDay: END_OF_MONTH, actorId: central.user.id };
    expect(await addBranchCutoff({ ...args, fromMonth: '2026-10' })).toEqual({
      ok: false,
      reason: 'frozen',
      frozenMonth: '2026-10',
    });
    expect(await addBranchCutoff({ ...args, fromMonth: '2026-11' })).toEqual({ ok: true });

    const row = await prisma.branchPayrollCutoff.findFirstOrThrow();
    await prisma.payroll.create({
      data: {
        employeeId: central.emp.id,
        month: '2026-11',
        incomeBase: new Prisma.Decimal(20_000),
        netPay: new Prisma.Decimal(20_000),
        status: 'Published',
      },
    });
    expect(await removeBranchCutoff({ id: row.id, actorId: central.user.id })).toEqual({
      ok: false,
      reason: 'frozen',
      frozenMonth: '2026-11',
    });
  });

  it('rejects 29/30 and malformed months, and the DB CHECK backs it up', async () => {
    const central = await makeEmployee('Central Audio');
    const base = { branchId: central.branch.id, actorId: central.user.id };
    expect(await addBranchCutoff({ ...base, fromMonth: '2026-10', cutoffDay: 30 })).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(await addBranchCutoff({ ...base, fromMonth: '2026-1', cutoffDay: 31 })).toEqual({
      ok: false,
      reason: 'invalid',
    });
    await expect(
      prisma.branchPayrollCutoff.create({
        data: { branchId: central.branch.id, fromMonth: '2026-10', cutoffDay: 30 },
      }),
    ).rejects.toThrow();
  });

  it('publish holds back an employee whose own window has not ended yet', async () => {
    const central = await makeEmployee('Central Audio');
    const cm = await makeEmployee('เชียงใหม่');
    await addBranchCutoff({
      branchId: central.branch.id,
      fromMonth: '2026-11',
      cutoffDay: END_OF_MONTH,
      actorId: central.user.id,
    });
    await runPayrollDraft('2026-11');
    const status = async (empId: string) => (await payrollFor(empId, '2026-11')).status;

    // The company day itself is not over yet — nobody publishes.
    const onCutoff = await publishPayroll('2026-11', { today: '2026-11-26' });
    expect(onCutoff.published).toEqual([]);
    expect(onCutoff.blockedPeriodOpen.map((b) => b.periodEnd).sort()).toEqual([
      '2026-11-26',
      '2026-11-30',
    ]);

    // The usual 29th publish: เชียงใหม่ goes out, Central stays in Draft.
    const usual = await publishPayroll('2026-11', { today: '2026-11-29' });
    expect(usual.published.map((p) => p.employeeId)).toEqual([cm.emp.id]);
    expect(usual.blockedPeriodOpen).toEqual([
      { employeeId: central.emp.id, name: 'Central Audio Test', periodEnd: '2026-11-30' },
    ]);
    expect(await status(cm.emp.id)).toBe('Published');
    expect(await status(central.emp.id)).toBe('Draft');

    // A late on Central's last day still lands on its November slip.
    await late(central.emp.id, '2026-11-30', central.user.id);
    expect(
      (await publishPayroll('2026-11', { today: '2026-11-30', employeeId: central.emp.id }))
        .blockedPeriodOpen,
    ).toHaveLength(1);
    const final = await publishPayroll('2026-11', { today: '2026-12-01' });
    expect(final.published.map((p) => p.employeeId)).toEqual([central.emp.id]);
    expect(final.blockedPeriodOpen).toEqual([]);
    const c = await payrollFor(central.emp.id, '2026-11');
    expect(c.status).toBe('Published');
    expect(Number(c.deductAttendance)).toBe(100);
  });

  it('refuses moving a paid employee between branches whose cut-offs differ', async () => {
    const central = await makeEmployee('Central Audio');
    const cm = await makeEmployee('เชียงใหม่');
    const lp = await makeEmployee('ลำปาง');
    await addBranchCutoff({
      branchId: central.branch.id,
      fromMonth: '2026-10',
      cutoffDay: END_OF_MONTH,
      actorId: central.user.id,
    });

    // Nothing paid yet → moving is fine; the drafts are recalculated.
    expect(
      await branchMoveBlockedByPaidMonth(central.emp.id, central.branch.id, cm.branch.id),
    ).toBe(null);

    await runPayrollDraft('2026-10');
    await prisma.payroll.updateMany({
      where: { month: '2026-10' },
      data: { status: 'Published', publishedAt: new Date() },
    });

    expect(
      await branchMoveBlockedByPaidMonth(central.emp.id, central.branch.id, cm.branch.id),
    ).toBe('2026-10');
    expect(await branchMoveBlockedByPaidMonth(cm.emp.id, cm.branch.id, central.branch.id)).toBe(
      '2026-10',
    );
    // Two company-day branches give identical windows — no reason to block.
    expect(await branchMoveBlockedByPaidMonth(cm.emp.id, cm.branch.id, lp.branch.id)).toBe(null);
  });
});
