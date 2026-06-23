import { Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { advanceBalanceFor } from '@/lib/advance/available';
import { prisma } from '@/lib/db/prisma';
import { getOtCandidates } from '@/lib/overtime/candidates';

/**
 * Integration tests (dedicated koolman_test DB) for two auth-free read services:
 *   - advanceBalanceFor — gathers "reserved" advances and computes availability.
 *   - getOtCandidates — schedule-driven OT detection with threshold + dedup.
 * The underlying pure math (calculateAdvanceBalance, overtimeMinutes) is unit-
 * tested elsewhere; here we exercise the DB gathering/filtering.
 */

const MONTH = '2026-06';
function uid(): string {
  return crypto.randomUUID();
}
/** A Bangkok wall-clock time on a given June 2026 day, as a UTC instant. */
function bkk(day: number, h: number, min: number): Date {
  return new Date(Date.UTC(2026, 5, day, h - 7, min));
}

async function resetDb() {
  await prisma.payroll.deleteMany({});
  await prisma.overtimeEntry.deleteMany({});
  await prisma.attendance.deleteMany({});
  await prisma.cashAdvance.deleteMany({});
  await prisma.recurringDeduction.deleteMany({});
  await prisma.leaveRequest.deleteMany({});
  await prisma.employee.deleteMany({});
  await prisma.workSchedule.deleteMany({}); // cascades WorkScheduleDay
  await prisma.user.deleteMany({});
  await prisma.leaveType.deleteMany({});
  await prisma.branch.deleteMany({});
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
    },
  });
}

async function makeEmployee(opts: {
  baseSalary: number;
  hasSso?: boolean;
  scheduleDays?: Array<{ dayOfWeek: number; startTime: string; endTime: string }>;
}) {
  const user = await prisma.user.create({ data: {} });
  const branch = await prisma.branch.create({ data: { name: `Branch-${uid().slice(0, 8)}` } });
  let workScheduleId: string | null = null;
  if (opts.scheduleDays) {
    const ws = await prisma.workSchedule.create({
      data: { name: `WS-${uid().slice(0, 8)}`, days: { create: opts.scheduleDays } },
    });
    workScheduleId = ws.id;
  }
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
      workScheduleId,
    },
  });
}

beforeEach(resetDb);
afterAll(async () => {
  await prisma.$disconnect();
});

describe('advanceBalanceFor (Monthly)', () => {
  it('available = baseSalary when nothing is reserved', async () => {
    const emp = await makeEmployee({ baseSalary: 20_000 });
    const bal = await advanceBalanceFor(emp.id);
    expect(bal.reserved).toBe(0);
    expect(bal.available).toBe(20_000);
    expect(bal.overdrawn).toBe(false);
  });

  it('reserves Pending + Approved-not-deducted, ignoring Cancelled/Rejected/deducted', async () => {
    const emp = await makeEmployee({ baseSalary: 20_000 });
    await prisma.cashAdvance.createMany({
      data: [
        { employeeId: emp.id, amount: new Prisma.Decimal(5_000), status: 'Pending' },
        {
          employeeId: emp.id,
          amount: new Prisma.Decimal(3_000),
          status: 'Approved',
          isDeducted: false,
        },
        { employeeId: emp.id, amount: new Prisma.Decimal(9_999), status: 'Cancelled' },
        { employeeId: emp.id, amount: new Prisma.Decimal(8_888), status: 'Rejected' },
        {
          employeeId: emp.id,
          amount: new Prisma.Decimal(2_000),
          status: 'Approved',
          isDeducted: true,
        },
      ],
    });
    const bal = await advanceBalanceFor(emp.id);
    expect(bal.reserved).toBe(8_000); // 5000 + 3000 only
    expect(bal.available).toBe(12_000);
  });

  it('excludeAdvanceId drops that advance from reserved (the approve-self case)', async () => {
    const emp = await makeEmployee({ baseSalary: 20_000 });
    const pending = await prisma.cashAdvance.create({
      data: { employeeId: emp.id, amount: new Prisma.Decimal(5_000), status: 'Pending' },
    });
    expect((await advanceBalanceFor(emp.id)).reserved).toBe(5_000);
    expect((await advanceBalanceFor(emp.id, pending.id)).reserved).toBe(0);
  });

  it('flags overdrawn when reserved exceeds the cap', async () => {
    const emp = await makeEmployee({ baseSalary: 20_000 });
    await prisma.cashAdvance.create({
      data: {
        employeeId: emp.id,
        amount: new Prisma.Decimal(25_000),
        status: 'Approved',
        isDeducted: false,
      },
    });
    const bal = await advanceBalanceFor(emp.id);
    expect(bal.available).toBe(-5_000);
    expect(bal.overdrawn).toBe(true);
  });

  it('caps at NET: subtracts SSO + active recurring deductions (C7)', async () => {
    // SSO = min(20000, 15000) × 5% = 750, capped at 750 (PayrollConfig in reset).
    const emp = await makeEmployee({ baseSalary: 20_000, hasSso: true });
    await prisma.recurringDeduction.create({
      data: {
        employeeId: emp.id,
        reason: 'เงินกู้บริษัท',
        monthlyAmount: new Prisma.Decimal(2_000),
        monthsRemaining: 5,
      },
    });
    // An ended / used-up recurring must NOT reduce the cap.
    await prisma.recurringDeduction.create({
      data: {
        employeeId: emp.id,
        reason: 'ผ่อนจบแล้ว',
        monthlyAmount: new Prisma.Decimal(9_999),
        monthsRemaining: 0,
      },
    });

    const bal = await advanceBalanceFor(emp.id);
    if (bal.kind !== 'monthly') throw new Error('expected monthly');
    expect(bal.deductions).toBe(2_750); // 750 SSO + 2,000 active loan
    expect(bal.available).toBe(17_250); // 20,000 − 2,750
  });

  it('ignores SSO when the employee is not enrolled', async () => {
    const emp = await makeEmployee({ baseSalary: 20_000, hasSso: false });
    const bal = await advanceBalanceFor(emp.id);
    if (bal.kind !== 'monthly') throw new Error('expected monthly');
    expect(bal.deductions).toBe(0);
    expect(bal.available).toBe(20_000);
  });
});

describe('getOtCandidates', () => {
  const schedule = [
    { dayOfWeek: 1, startTime: '09:00', endTime: '18:00' },
    { dayOfWeek: 2, startTime: '09:00', endTime: '18:00' },
    { dayOfWeek: 3, startTime: '09:00', endTime: '18:00' },
  ];

  async function checkIn(employeeId: string, day: number, clockOut: Date) {
    return prisma.attendance.create({
      data: {
        employeeId,
        date: new Date(Date.UTC(2026, 5, day)),
        type: 'CheckIn',
        source: 'Liff',
        clockInAt: bkk(day, 9, 0),
        clockOutAt: clockOut,
        createdById: uid(),
      },
    });
  }

  it('surfaces only clock-outs past the scheduled end by ≥ threshold (30m), deduping decided days', async () => {
    const emp = await makeEmployee({ baseSalary: 20_000, scheduleDays: schedule });
    const a = await checkIn(emp.id, 15, bkk(15, 18, 45)); // Mon, +45 → candidate
    await checkIn(emp.id, 16, bkk(16, 18, 10)); // Tue, +10 → below threshold
    await checkIn(emp.id, 17, bkk(17, 18, 50)); // Wed, +50 but already decided
    await prisma.overtimeEntry.create({
      data: {
        employeeId: emp.id,
        date: new Date(Date.UTC(2026, 5, 17)),
        minutes: 50,
        rateType: 'PerHourAmount',
        ratePerHour: new Prisma.Decimal(50),
        computedAmount: new Prisma.Decimal(0),
        status: 'Approved',
        createdById: uid(),
      },
    });

    const candidates = await getOtCandidates({ ym: MONTH, employeeId: emp.id });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.attendanceId).toBe(a.id);
    expect(candidates[0]?.scheduledEnd).toBe('18:00');
    expect(candidates[0]?.clockOut).toBe('18:45');
    expect(candidates[0]?.minutesOver).toBe(45);
    expect(candidates[0]?.date).toBe('2026-06-15');
  });

  it('ignores employees with no schedule (no scheduled end to measure against)', async () => {
    const emp = await makeEmployee({ baseSalary: 20_000 }); // no schedule
    await checkIn(emp.id, 15, bkk(15, 20, 0)); // very late, but no schedule
    expect(await getOtCandidates({ ym: MONTH, employeeId: emp.id })).toHaveLength(0);
  });
});
