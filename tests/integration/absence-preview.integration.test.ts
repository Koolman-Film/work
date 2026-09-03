import { Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { previewAbsences } from '@/lib/attendance/absence-preview';
import { prisma } from '@/lib/db/prisma';

const MONTH = '2026-06';

// Local reset + config seed, matching the convention in
// payslip-document.integration.test.ts. There is no shared `helpers/` module:
// `tests/integration/_reset-db.ts` is a `setupFiles` hook that truncates BETWEEN
// FILES, and each file still owns its own `beforeEach` reset. previewAbsences
// calls payrollConfig.findFirstOrThrow, so the config rows are required, not
// decoration.
async function reset() {
  await prisma.attendance.deleteMany({});
  await prisma.leaveRequest.deleteMany({});
  await prisma.holiday.deleteMany({});
  await prisma.employee.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.branch.deleteMany({});
  await prisma.workScheduleDay.deleteMany({});
  await prisma.workSchedule.deleteMany({});
  await prisma.payrollConfig.deleteMany({});
  await prisma.leaveConfig.deleteMany({});
  await prisma.leaveConfig.create({ data: {} });
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

/** Employee.userId and Employee.branchId are BOTH required (schema.prisma). */
async function makeEmployee(workScheduleId: string | null) {
  const user = await prisma.user.create({ data: {} });
  const branch = await prisma.branch.create({ data: { name: `br-${user.id.slice(0, 6)}` } });
  const employee = await prisma.employee.create({
    data: {
      userId: user.id,
      branchId: branch.id,
      firstName: 'Absent',
      lastName: 'Tester',
      baseSalary: new Prisma.Decimal(12_000),
      salaryType: 'Monthly',
      status: 'Active',
      hiredAt: new Date('2026-01-01'),
      ...(workScheduleId ? { workScheduleId } : {}),
    },
  });
  // Attendance.createdById is required, so hand back the User that can own the
  // rows these tests create.
  return { employee, userId: user.id };
}

/** An approved LeaveRequest — the source payroll and the preview BOTH read.
 *  Production has zero OnLeave attendance rows without one behind them, so
 *  seeding the attendance row alone never represented real leave. */
async function approveLeave(employeeId: string, startYmd: string, endYmd = startYmd) {
  const lt = await prisma.leaveType.create({
    data: {
      name: `lt-${Math.random().toString(36).slice(2, 8)}`,
      overQuotaPolicy: 'DeductPay',
      annualQuota: 10,
    },
  });
  return prisma.leaveRequest.create({
    data: {
      employeeId,
      leaveTypeId: lt.id,
      startDate: new Date(`${startYmd}T00:00:00.000Z`),
      endDate: new Date(`${endYmd}T00:00:00.000Z`),
      reason: 'it',
      status: 'Approved',
    },
  });
}

async function seed() {
  const schedule = await prisma.workSchedule.create({
    data: {
      name: 'it-mon-fri',
      days: {
        create: [1, 2, 3, 4, 5].map((dayOfWeek) => ({
          dayOfWeek,
          startTime: '09:00',
          endTime: '17:00',
        })),
      },
    },
  });
  const { employee, userId } = await makeEmployee(schedule.id);
  return { employee, userId, schedule };
}

describe('previewAbsences', () => {
  beforeEach(reset);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('derives a full scheduled day when there is no check-in and no leave', async () => {
    const { employee } = await seed();
    // 2026-06-01 is a Monday, inside the 2026-06 window (27 May – 26 Jun).
    // 420, not the 480 wall-clock span: the seeded schedule is 09:00-17:00 and
    // the default LeaveConfig break is 12:00-13:00, so a full scheduled day is
    // 7 paid hours — which is also exactly standardDayMinutes for that config.
    // The schedule and leave sides are measured on the same basis by design.
    const preview = await previewAbsences(MONTH);
    const row = preview.rows.find((r) => r.employeeId === employee.id);
    expect(row?.days.some((d) => d.date === '2026-06-01' && d.minutes === 420)).toBe(true);
  });

  it('derives nothing for a date the employee checked in', async () => {
    const { employee, userId } = await seed();
    await prisma.attendance.create({
      data: {
        employeeId: employee.id,
        date: new Date('2026-06-01'),
        type: 'CheckIn',
        source: 'Liff',
        createdById: userId,
      },
    });
    const preview = await previewAbsences(MONTH);
    const row = preview.rows.find((r) => r.employeeId === employee.id);
    expect(row?.days.some((d) => d.date === '2026-06-01')).toBe(false);
  });

  it('yields to an admin-keyed manual Absent rather than deriving the same date twice', async () => {
    const { employee, userId } = await seed();
    await prisma.attendance.create({
      data: {
        employeeId: employee.id,
        date: new Date('2026-06-01'),
        type: 'Absent',
        // Manual: this is the admin-keyed row whose precedence is under test.
        source: 'Manual',
        createdById: userId,
      },
    });
    const preview = await previewAbsences(MONTH);
    const row = preview.rows.find((r) => r.employeeId === employee.id);
    expect(row?.days.some((d) => d.date === '2026-06-01')).toBe(false);
  });

  it('exempts a day covered by approved leave whose minutes were never recorded', async () => {
    // The maternity-leave shape: production has 14 OnLeave rows with a null
    // durationMinutes, all one employee's approved leave. Reading leave from the
    // REQUEST rather than the derived rows makes the duration irrelevant.
    const { employee } = await seed();
    await approveLeave(employee.id, '2026-06-01');
    const preview = await previewAbsences(MONTH);
    const row = preview.rows.find((r) => r.employeeId === employee.id);
    expect(row?.days.some((d) => d.date === '2026-06-01')).toBe(false);
  });

  it('derives nothing at all for a day with partial leave', async () => {
    const { employee } = await seed();
    const lt = await prisma.leaveType.create({
      data: {
        name: `half-${Math.random().toString(36).slice(2, 8)}`,
        overQuotaPolicy: 'DeductPay',
        annualQuota: 10,
      },
    });
    await prisma.leaveRequest.create({
      data: {
        employeeId: employee.id,
        leaveTypeId: lt.id,
        startDate: new Date('2026-06-01'),
        endDate: new Date('2026-06-01'),
        unit: 'HalfMorning',
        startTime: '09:00',
        endTime: '12:00',
        reason: 'it',
        status: 'Approved',
      },
    });
    const preview = await previewAbsences(MONTH);
    const row = preview.rows.find((r) => r.employeeId === employee.id);
    // Whole days only: any approved leave exempts the day rather than charging
    // the uncovered part. See deriveAbsentMinutes for why.
    expect(row?.days.some((d) => d.date === '2026-06-01')).toBe(false);
  });

  it('derives nothing on a holiday', async () => {
    const { employee } = await seed();
    await prisma.holiday.create({
      data: { date: new Date('2026-06-01'), name: 'it-holiday' },
    });
    const preview = await previewAbsences(MONTH);
    const row = preview.rows.find((r) => r.employeeId === employee.id);
    expect(row?.days.some((d) => d.date === '2026-06-01')).toBe(false);
  });

  it('skips an employee with no work schedule instead of assuming Mon-Sat', async () => {
    const { employee: noSchedule } = await makeEmployee(null);
    const preview = await previewAbsences(MONTH);
    expect(preview.rows.some((r) => r.employeeId === noSchedule.id)).toBe(false);
    expect(preview.skippedNoSchedule).toBeGreaterThanOrEqual(1);
  });

  it('never derives a date in the future — nobody can have checked in yet', async () => {
    // The current payroll month's window runs to the cutoff, which for most of
    // the month is in the FUTURE. Iterating it whole would derive every
    // remaining workday as a full absence for every employee, which is the
    // default view of this page. Use a month whose window straddles today.
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
    const thisMonth = today.slice(0, 7);
    await seed();
    const preview = await previewAbsences(thisMonth);
    const derived = preview.rows.flatMap((r) => r.days.map((d) => d.date));
    // STRICTLY before today. A day is only assessable once it is over: until
    // then "no check-in yet" is the morning, not an absence. Read at 00:08 this
    // would otherwise list nearly every employee as absent for a day they were
    // about to work.
    expect(derived.every((d) => d < today)).toBe(true);
  });

  it('does not invent an absence from the schedule/leave basis mismatch', async () => {
    // Production's exact shape: a 09:00-18:00 schedule (540 wall-clock minutes)
    // against a full-day leave recorded as the 480-minute LeaveConfig standard
    // day. Naively subtracting leaves a phantom 60-minute absence for EVERY full
    // day of leave anyone takes — it showed up on 8 employees in the first real
    // preview. The unpaid break has to come off the schedule side first.
    const schedule = await prisma.workSchedule.create({
      data: {
        name: 'it-0900-1800',
        days: {
          create: [1, 2, 3, 4, 5].map((dayOfWeek) => ({
            dayOfWeek,
            startTime: '09:00',
            endTime: '18:00',
          })),
        },
      },
    });
    const { employee } = await makeEmployee(schedule.id);
    await prisma.leaveConfig.updateMany({
      data: {
        morningStart: '09:00',
        morningEnd: '12:00',
        afternoonStart: '13:00',
        afternoonEnd: '18:00',
      },
    });
    await approveLeave(employee.id, '2026-06-01');
    const preview = await previewAbsences(MONTH);
    const row = preview.rows.find((r) => r.employeeId === employee.id);
    expect(row?.days.some((d) => d.date === '2026-06-01')).toBe(false);
  });

  it('skips Daily/Hourly employees — payroll refuses to process them at all', async () => {
    // calcPayroll throws PayrollCalcError for any non-Monthly salaryType, so a
    // derived absence for one could never become a deduction. Showing it raises
    // alarm about money that cannot move, and their baseSalary is a RATE, so the
    // salary column would mislead too. Caught by looking at the rendered page:
    // two of its three rows were Daily employees.
    const schedule = await prisma.workSchedule.create({
      data: {
        name: 'it-daily',
        days: {
          create: [1, 2, 3, 4, 5].map((dayOfWeek) => ({
            dayOfWeek,
            startTime: '09:00',
            endTime: '17:00',
          })),
        },
      },
    });
    const { employee } = await makeEmployee(schedule.id);
    await prisma.employee.update({
      where: { id: employee.id },
      data: { salaryType: 'Daily', baseSalary: new Prisma.Decimal(600) },
    });
    const preview = await previewAbsences(MONTH);
    expect(preview.rows.some((r) => r.employeeId === employee.id)).toBe(false);
    expect(preview.skippedNotChargeable).toBeGreaterThanOrEqual(1);
  });

  it('returns nothing for a month that has not happened yet', async () => {
    // Reachable from the URL: /admin/tools/absence-preview?m=2027-01. The whole
    // window is in the future, so clamping to today leaves start > end. Prove it
    // yields an empty result rather than iterating backwards or throwing.
    await seed();
    const future = new Date();
    future.setUTCFullYear(future.getUTCFullYear() + 1);
    const preview = await previewAbsences(future.toISOString().slice(0, 7));
    expect(preview.rows).toEqual([]);
  });

  it('never derives a date before the employee was hired', async () => {
    // Found against production: viewing July showed เคน and แอ็ก as absent for
    // 25 days each (฿12,500) — but they were hired on 26 Aug and 3 Aug. The
    // whole window predated their employment. เคน's salary is ฿12,000, so the
    // derived deduction exceeded his entire pay.
    const schedule = await prisma.workSchedule.create({
      data: {
        name: 'it-hire-date',
        days: {
          create: [1, 2, 3, 4, 5].map((dayOfWeek) => ({
            dayOfWeek,
            startTime: '09:00',
            endTime: '17:00',
          })),
        },
      },
    });
    const { employee } = await makeEmployee(schedule.id);
    // Hired midway through the 2026-06 window (27 May – 26 Jun).
    await prisma.employee.update({
      where: { id: employee.id },
      data: { hiredAt: new Date('2026-06-15') },
    });
    const preview = await previewAbsences(MONTH);
    const row = preview.rows.find((r) => r.employeeId === employee.id);
    const dates = row?.days.map((d) => d.date) ?? [];
    expect(dates.length).toBeGreaterThan(0); // still derives AFTER the hire date
    expect(dates.every((d) => d >= '2026-06-15')).toBe(true);
  });

  it('writes nothing — the Attendance table is unchanged by a preview', async () => {
    const { employee } = await seed();
    const before = await prisma.attendance.count();
    await previewAbsences(MONTH);
    expect(await prisma.attendance.count()).toBe(before);
    expect(employee.id).toBeTruthy();
  });
});
