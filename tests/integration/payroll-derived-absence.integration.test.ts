import { Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { runPayrollDraft } from '@/lib/payroll/run';

/**
 * Derived absence, end to end against the real database.
 *
 * Absence did not exist in this system before: `Absent` rows come only from the
 * admin manual-entry form, so payroll deducted only what somebody keyed. These
 * tests pin the money that changes when `PayrollConfig.absenceDerivedFrom` is
 * set — and, first and most importantly, that NOTHING changes while it is null.
 */

const MONTH = '2026-06';
// The 2026-06 window is 27 May – 26 Jun (cutoffDay 26 below). 2026-06-01 is a
// Monday; 2026-06-02 a Tuesday.
const CUTOFF_ON = new Date('2026-05-27T00:00:00.000Z');

function uid(): string {
  return crypto.randomUUID();
}

async function reset(absenceDerivedFrom: Date | null) {
  await prisma.payroll.deleteMany({});
  await prisma.attendance.deleteMany({});
  await prisma.leaveRequest.deleteMany({});
  await prisma.employee.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.leaveType.deleteMany({});
  await prisma.branch.deleteMany({});
  await prisma.workScheduleDay.deleteMany({});
  await prisma.workSchedule.deleteMany({});
  await prisma.holiday.deleteMany({});
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
      cutoffDay: 26,
      absenceDerivedFrom,
    },
  });
}

/** Mon–Fri 09:00–17:00. With the default 12:00–13:00 break that is 420 paid
 *  minutes, which is also standardDayMinutes — so one absent day is one day. */
async function makeScheduledEmployee(baseSalary = 30_000) {
  const schedule = await prisma.workSchedule.create({
    data: {
      name: `sched-${uid().slice(0, 8)}`,
      days: {
        create: [1, 2, 3, 4, 5].map((dayOfWeek) => ({
          dayOfWeek,
          startTime: '09:00',
          endTime: '17:00',
        })),
      },
    },
  });
  const user = await prisma.user.create({ data: {} });
  const branch = await prisma.branch.create({ data: { name: `Branch-${uid().slice(0, 8)}` } });
  return prisma.employee.create({
    data: {
      userId: user.id,
      firstName: 'Derived',
      lastName: 'Absence',
      branchId: branch.id,
      salaryType: 'Monthly',
      baseSalary: new Prisma.Decimal(baseSalary),
      hasSso: false,
      allowanceAmount: new Prisma.Decimal(0),
      status: 'Active',
      hiredAt: new Date('2026-01-01'),
      workScheduleId: schedule.id,
    },
  });
}

/** Every scheduled day in the window except the ones named, so only those
 *  derive. Without this the employee is absent for the whole month. */
async function checkInEveryDayExcept(employeeId: string, exceptYmd: readonly string[]) {
  const user = await prisma.user.findFirstOrThrow();
  const skip = new Set(exceptYmd);
  const start = new Date('2026-05-27T00:00:00.000Z');
  const end = new Date('2026-06-26T00:00:00.000Z');
  for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
    const d = new Date(t);
    const ymd = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6 || skip.has(ymd)) continue;
    await prisma.attendance.create({
      data: {
        employeeId,
        date: d,
        type: 'CheckIn',
        source: 'Liff',
        createdById: user.id,
      },
    });
  }
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe('derived absence — the switch is off', () => {
  beforeEach(() => reset(null));

  it('DEPLOY SAFETY: with absenceDerivedFrom null, a total no-show costs nothing', async () => {
    // The single most important assertion in this file. Shipping this feature
    // must not change one baht of anyone's pay until an admin sets the date.
    const emp = await makeScheduledEmployee();
    await runPayrollDraft(MONTH);
    const row = await prisma.payroll.findFirstOrThrow({ where: { employeeId: emp.id } });
    expect(row.deductAttendance.toString()).toBe('0');
    expect(row.netPay.toString()).toBe('30000');
  });
});

describe('derived absence — the switch is on', () => {
  beforeEach(() => reset(CUTOFF_ON));

  it('charges one day for a scheduled day with no check-in and no leave', async () => {
    const emp = await makeScheduledEmployee();
    await checkInEveryDayExcept(emp.id, ['2026-06-01']);
    await runPayrollDraft(MONTH);
    const row = await prisma.payroll.findFirstOrThrow({ where: { employeeId: emp.id } });
    // 30000 / 30 working days = 1000 per day.
    expect(row.deductAttendance.toString()).toBe('1000');
  });

  it('never charges a date before the cutoff', async () => {
    await reset(new Date('2026-06-10T00:00:00.000Z'));
    const emp = await makeScheduledEmployee();
    // 06-01 is before the cutoff, 06-11 after it. Only the second is charged.
    await checkInEveryDayExcept(emp.id, ['2026-06-01', '2026-06-11']);
    await runPayrollDraft(MONTH);
    const row = await prisma.payroll.findFirstOrThrow({ where: { employeeId: emp.id } });
    expect(row.deductAttendance.toString()).toBe('1000');
  });

  it('never charges a day covered by approved leave', async () => {
    const emp = await makeScheduledEmployee();
    const lt = await prisma.leaveType.create({
      data: { name: `lt-${uid().slice(0, 8)}`, overQuotaPolicy: 'DeductPay', annualQuota: 10 },
    });
    await prisma.leaveRequest.create({
      data: {
        employeeId: emp.id,
        leaveTypeId: lt.id,
        startDate: new Date('2026-06-01'),
        endDate: new Date('2026-06-01'),
        reason: 'x',
        status: 'Approved',
      },
    });
    await checkInEveryDayExcept(emp.id, ['2026-06-01']);
    await runPayrollDraft(MONTH);
    const row = await prisma.payroll.findFirstOrThrow({ where: { employeeId: emp.id } });
    expect(row.deductAttendance.toString()).toBe('0');
  });

  it('charges a keyed Absent day exactly once, never twice', async () => {
    const emp = await makeScheduledEmployee();
    const user = await prisma.user.findFirstOrThrow();
    await checkInEveryDayExcept(emp.id, ['2026-06-01']);
    await prisma.attendance.create({
      data: {
        employeeId: emp.id,
        date: new Date('2026-06-01'),
        type: 'Absent',
        source: 'Manual',
        createdById: user.id,
      },
    });
    await runPayrollDraft(MONTH);
    const row = await prisma.payroll.findFirstOrThrow({ where: { employeeId: emp.id } });
    // One day, not two: the derivation yields to the admin's explicit row.
    expect(row.deductAttendance.toString()).toBe('1000');
  });

  it('never charges TODAY — the day is not over yet', async () => {
    // Found at 00:08 on 2026-09-04: derivation included today, so 47 of 48
    // employees read as absent simply because nobody had clocked in yet.
    // Use the CURRENT payroll month so the window contains today.
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
    await reset(new Date('2026-01-01T00:00:00.000Z'));
    const emp = await makeScheduledEmployee();
    await runPayrollDraft(today.slice(0, 7));
    const row = await prisma.payroll.findFirst({ where: { employeeId: emp.id } });
    // Whatever it charges, it must not include today. Proven by re-running with
    // the cutoff set to today: nothing on/after today may derive, so zero.
    await prisma.payrollConfig.updateMany({
      data: { absenceDerivedFrom: new Date(`${today}T00:00:00.000Z`) },
    });
    await prisma.payroll.deleteMany({});
    await runPayrollDraft(today.slice(0, 7));
    const onlyToday = await prisma.payroll.findFirstOrThrow({ where: { employeeId: emp.id } });
    expect(onlyToday.deductAttendance.toString()).toBe('0');
    expect(row).toBeTruthy();
  });

  it('never derives for an employee with no work schedule', async () => {
    const user = await prisma.user.create({ data: {} });
    const branch = await prisma.branch.create({ data: { name: `B-${uid().slice(0, 8)}` } });
    const emp = await prisma.employee.create({
      data: {
        userId: user.id,
        firstName: 'No',
        lastName: 'Schedule',
        branchId: branch.id,
        salaryType: 'Monthly',
        baseSalary: new Prisma.Decimal(30_000),
        hasSso: false,
        allowanceAmount: new Prisma.Decimal(0),
        status: 'Active',
        hiredAt: new Date('2026-01-01'),
      },
    });
    await runPayrollDraft(MONTH);
    const row = await prisma.payroll.findFirstOrThrow({ where: { employeeId: emp.id } });
    expect(row.deductAttendance.toString()).toBe('0');
  });

  it('never derives a date before the employee was hired', async () => {
    const emp = await makeScheduledEmployee();
    await prisma.employee.update({
      where: { id: emp.id },
      data: { hiredAt: new Date('2026-06-15') },
    });
    // No check-ins at all, so everything on/after the hire date derives — and
    // nothing before it. 15 Jun is a Monday; 15..26 Jun holds 10 weekdays.
    await runPayrollDraft(MONTH);
    const row = await prisma.payroll.findFirstOrThrow({ where: { employeeId: emp.id } });
    expect(row.deductAttendance.toString()).toBe('10000');
  });
});
