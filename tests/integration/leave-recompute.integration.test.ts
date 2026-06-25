import { Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { recomputeLeaveCharges } from '@/lib/leave/recompute';

/**
 * Integration test (koolman_test DB) for the leave recompute that backs the
 * admin maintenance tool: it must (a) fill null chargedMinutes and (b) refresh
 * over-quota/deduction in approval order against the current entitlement.
 */

const YEAR = 2026;
const uid = () => crypto.randomUUID();
const day = (d: number) => new Date(Date.UTC(2026, 5, d));

async function reset() {
  // Wipe every table that FKs Employee (other integration files share this DB).
  await prisma.payrollAdjustment.deleteMany({});
  await prisma.payroll.deleteMany({});
  await prisma.recurringDeduction.deleteMany({});
  await prisma.overtimeEntry.deleteMany({});
  await prisma.attendance.deleteMany({});
  await prisma.cashAdvance.deleteMany({});
  await prisma.leaveRequest.deleteMany({});
  await prisma.leaveEntitlement.deleteMany({});
  await prisma.employee.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.leaveType.deleteMany({});
  await prisma.branch.deleteMany({});
  await prisma.payrollConfig.deleteMany({});
  await prisma.leaveConfig.deleteMany({});
  await prisma.leaveConfig.create({ data: {} }); // std day = 09–12 + 13–17 = 420 min
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
    },
  });
}

async function makeEmployee() {
  const user = await prisma.user.create({ data: {} });
  const branch = await prisma.branch.create({ data: { name: `B-${uid().slice(0, 8)}` } });
  return prisma.employee.create({
    data: {
      userId: user.id,
      firstName: 'Test',
      lastName: 'W',
      nickname: 'เทส',
      branchId: branch.id,
      salaryType: 'Monthly',
      baseSalary: new Prisma.Decimal(12_600), // rate = 12600/30/420 = 1.0 ฿/min
      status: 'Active',
      hiredAt: new Date('2026-01-01'),
    },
  });
}

beforeEach(reset);
afterAll(async () => {
  await prisma.$disconnect();
});

describe('recomputeLeaveCharges', () => {
  it('refreshes stale over-quota in approval order against the current entitlement', async () => {
    const emp = await makeEmployee();
    const lt = await prisma.leaveType.create({
      data: { name: `ลากิจ-${uid().slice(0, 8)}`, overQuotaPolicy: 'DeductPay', annualQuota: 5 },
    });
    // Entitlement = 1 day (420 min).
    await prisma.leaveEntitlement.create({
      data: {
        employeeId: emp.id,
        leaveTypeId: lt.id,
        periodYear: YEAR,
        grantedMinutes: 420,
        carryoverMinutes: 0,
        adjustmentMinutes: 0,
      },
    });
    // A: 420 within quota; B: 60 — but stale snapshot says over 0 / no deduct.
    const a = await prisma.leaveRequest.create({
      data: {
        employeeId: emp.id,
        leaveTypeId: lt.id,
        startDate: day(3),
        endDate: day(3),
        reason: 'a',
        status: 'Approved',
        chargedMinutes: 420,
        overQuotaMinutes: 0,
        reviewedAt: new Date('2026-06-03T01:00:00Z'),
      },
    });
    const b = await prisma.leaveRequest.create({
      data: {
        employeeId: emp.id,
        leaveTypeId: lt.id,
        startDate: day(5),
        endDate: day(5),
        reason: 'b',
        status: 'Approved',
        chargedMinutes: 60,
        overQuotaMinutes: 0, // stale — should be 60
        deductAmount: null, // stale — should be ฿60
        reviewedAt: new Date('2026-06-05T01:00:00Z'),
      },
    });

    const dry = await recomputeLeaveCharges({ apply: false });
    const bChange = dry.changes.find((c) => c.leaveRequestId === b.id);
    expect(dry.changes.find((c) => c.leaveRequestId === a.id)).toBeUndefined(); // A unchanged
    expect(bChange?.newOverMinutes).toBe(60);
    expect(bChange?.newDeduct).toBe(60);
    expect(dry.applied).toBe(0);
    // Dry run wrote nothing.
    expect(
      (await prisma.leaveRequest.findUniqueOrThrow({ where: { id: b.id } })).overQuotaMinutes,
    ).toBe(0);

    const applied = await recomputeLeaveCharges({ apply: true });
    expect(applied.applied).toBe(1);
    const bRow = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: b.id } });
    expect(bRow.overQuotaMinutes).toBe(60);
    expect(Number(bRow.deductAmount)).toBe(60);
  });

  it('fills null chargedMinutes for an approved leave', async () => {
    const emp = await makeEmployee();
    const lt = await prisma.leaveType.create({
      data: { name: `ลากิจ-${uid().slice(0, 8)}`, overQuotaPolicy: 'DeductPay', annualQuota: 5 },
    });
    const r = await prisma.leaveRequest.create({
      data: {
        employeeId: emp.id,
        leaveTypeId: lt.id,
        startDate: day(8), // Mon 2026-06-08
        endDate: day(8),
        unit: 'FullDay',
        reason: 'c',
        status: 'Approved',
        chargedMinutes: null, // the bug
        reviewedAt: new Date('2026-06-08T01:00:00Z'),
      },
    });

    await recomputeLeaveCharges({ apply: true });
    const row = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.chargedMinutes).toBe(420); // 1 working day × 420
  });
});
