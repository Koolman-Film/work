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
    const preview = await previewAbsences(MONTH);
    const row = preview.rows.find((r) => r.employeeId === employee.id);
    expect(row?.days.some((d) => d.date === '2026-06-01' && d.minutes === 480)).toBe(true);
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

  it('treats an OnLeave row with a NULL duration as fully covered', async () => {
    // The maternity-leave shape: approved leave whose minutes were never
    // recorded must never read as an absence.
    const { employee, userId } = await seed();
    await prisma.attendance.create({
      data: {
        employeeId: employee.id,
        date: new Date('2026-06-01'),
        type: 'OnLeave',
        source: 'Manual',
        createdById: userId,
        durationMinutes: null,
      },
    });
    const preview = await previewAbsences(MONTH);
    const row = preview.rows.find((r) => r.employeeId === employee.id);
    expect(row?.days.some((d) => d.date === '2026-06-01')).toBe(false);
  });

  it('derives only the uncovered part of a half-day leave', async () => {
    const { employee, userId } = await seed();
    await prisma.attendance.create({
      data: {
        employeeId: employee.id,
        date: new Date('2026-06-01'),
        type: 'OnLeave',
        source: 'Manual',
        createdById: userId,
        durationMinutes: 180,
      },
    });
    const preview = await previewAbsences(MONTH);
    const row = preview.rows.find((r) => r.employeeId === employee.id);
    expect(row?.days.find((d) => d.date === '2026-06-01')?.minutes).toBe(300);
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

  it('writes nothing — the Attendance table is unchanged by a preview', async () => {
    const { employee } = await seed();
    const before = await prisma.attendance.count();
    await previewAbsences(MONTH);
    expect(await prisma.attendance.count()).toBe(before);
    expect(employee.id).toBeTruthy();
  });
});
