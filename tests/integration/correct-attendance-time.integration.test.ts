/**
 * Integration coverage for correctAttendanceTime against a REAL Postgres.
 *
 * This action MOVES MONEY — changing clockInAt changes lateness, which changes
 * deductAttendance — so the behaviours that matter are:
 *   - the Late row is kept in step, in the SAME transaction (created, updated,
 *     or soft-deleted as the corrected time demands);
 *   - the audit entry carries the OLD time, because an in-place overwrite
 *     leaves no other record that it was ever different;
 *   - a closed payroll month is refused — that money is frozen;
 *   - a reason is mandatory.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db/prisma';

const actor = { id: '22222222-2222-4222-8222-222222222222' };

vi.mock('@/lib/auth/check-permission', () => ({
  requirePermission: vi.fn(async () => ({ user: actor, authUserId: actor.id, tier: 'Admin' })),
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

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => ({ get: (_n: string) => null })),
}));

const { correctAttendanceTime } = await import('@/lib/attendance/correct-time');

const uid = () => crypto.randomUUID();
const DATE = new Date('2026-08-20T00:00:00.000Z'); // a Thursday
const at = (hhmm: string) => new Date(`2026-08-20T${hhmm}:00.000+07:00`);

async function reset() {
  await prisma.$executeRawUnsafe('TRUNCATE "AuditLog", "Attendance", "Payroll" CASCADE');
  await prisma.$executeRawUnsafe('DELETE FROM "Employee"');
  await prisma.$executeRawUnsafe('DELETE FROM "User"');
  await prisma.$executeRawUnsafe('DELETE FROM "Branch"');
  await prisma.$executeRawUnsafe('DELETE FROM "PayrollConfig"');
}

async function seed(opts: { clockIn: string; lateMinutes?: number }) {
  await prisma.payrollConfig.create({
    data: {
      ssoRate: '0.05',
      ssoSalaryCap: '15000',
      ssoAmountCap: '750',
      otMultiplier: '1.5',
      absentDeductionPerDay: '500',
      lateDeduction: '100',
      earlyLeaveDeduction: '100',
      cutoffDay: 25,
      workStartTime: '09:00',
      lateGraceMinutes: 15,
    },
  });
  const user = await prisma.user.create({ data: {} });
  const branch = await prisma.branch.create({ data: { name: `B-${uid().slice(0, 8)}` } });
  const emp = await prisma.employee.create({
    data: {
      userId: user.id,
      firstName: 'Test',
      lastName: 'Worker',
      branchId: branch.id,
      salaryType: 'Monthly',
      baseSalary: '15000',
      status: 'Active',
      hiredAt: new Date('2026-01-01'),
    },
  });
  const checkIn = await prisma.attendance.create({
    data: {
      employeeId: emp.id,
      date: DATE,
      type: 'CheckIn',
      source: 'Liff',
      clockInAt: at(opts.clockIn),
      clockOutAt: at('18:00'),
      createdById: user.id,
    },
  });
  if (opts.lateMinutes) {
    await prisma.attendance.create({
      data: {
        employeeId: emp.id,
        date: DATE,
        type: 'Late',
        source: 'Liff',
        durationMinutes: opts.lateMinutes,
        createdById: user.id,
      },
    });
  }
  return { emp, checkIn };
}

const lateRow = (employeeId: string) =>
  prisma.attendance.findFirst({
    where: { employeeId, date: DATE, type: 'Late', deletedAt: null },
    select: { durationMinutes: true },
  });

beforeEach(reset);
afterAll(async () => {
  await prisma.$disconnect();
});

describe('correctAttendanceTime', () => {
  it('corrects the time and records the OLD value in the audit trail', async () => {
    const { emp, checkIn } = await seed({ clockIn: '09:40', lateMinutes: 40 });

    const res = await correctAttendanceTime({
      attendanceId: checkIn.id,
      clockIn: '09:05',
      clockOut: '18:00',
      reason: 'พนักงานแจ้งว่าเครื่องสแกนค้าง',
    });
    expect(res.ok).toBe(true);

    const row = await prisma.attendance.findUniqueOrThrow({ where: { id: checkIn.id } });
    expect(row.clockInAt?.toISOString()).toBe(at('09:05').toISOString());
    expect(row.isOverridden).toBe(true);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: checkIn.id, action: 'attendance.correct-time' },
    });
    // The overwrite destroys the previous time on the row itself — the audit
    // entry is the only place it still exists.
    const before = audit.beforeValue as Record<string, unknown>;
    expect(before.clockInAt).toBe(at('09:40').toISOString());
    expect(before.lateMinutes).toBe(40);
    expect(emp.id).toBeTruthy();
  });

  it('removes the Late row when the corrected time is within grace', async () => {
    // 09:05 with a 09:00 start and 15 minutes of grace is not late.
    const { emp, checkIn } = await seed({ clockIn: '09:40', lateMinutes: 40 });

    await correctAttendanceTime({
      attendanceId: checkIn.id,
      clockIn: '09:05',
      clockOut: '18:00',
      reason: 'สแกนค้าง',
    });

    expect(await lateRow(emp.id)).toBeNull();
  });

  it('creates a Late row when the corrected time is beyond grace', async () => {
    const { emp, checkIn } = await seed({ clockIn: '09:05' });
    expect(await lateRow(emp.id)).toBeNull();

    await correctAttendanceTime({
      attendanceId: checkIn.id,
      clockIn: '09:40',
      clockOut: '18:00',
      reason: 'แก้ให้ตรงกับกล้องวงจรปิด',
    });

    // 09:40 against a 09:00 start is 40 minutes late — the 15-minute grace
    // decides WHETHER it counts as late, not the minute it is measured from.
    expect((await lateRow(emp.id))?.durationMinutes).toBe(40);
  });

  it('updates an existing Late row rather than violating the unique index', async () => {
    const { emp, checkIn } = await seed({ clockIn: '09:40', lateMinutes: 40 });

    const res = await correctAttendanceTime({
      attendanceId: checkIn.id,
      clockIn: '10:00',
      clockOut: '18:00',
      reason: 'แก้เวลา',
    });

    expect(res.ok).toBe(true);
    expect((await lateRow(emp.id))?.durationMinutes).toBe(60);
  });

  it('refuses once the covering payroll month is closed', async () => {
    const { emp, checkIn } = await seed({ clockIn: '09:40', lateMinutes: 40 });
    // 20 Aug with cutoffDay 25 falls in the 2026-08 payroll month.
    await prisma.payroll.create({
      data: {
        employeeId: emp.id,
        month: '2026-08',
        status: 'Published',
        incomeBase: '15000',
        netPay: '15000',
      },
    });

    const res = await correctAttendanceTime({
      attendanceId: checkIn.id,
      clockIn: '09:05',
      clockOut: '18:00',
      reason: 'สแกนค้าง',
    });

    expect(res.ok).toBe(false);
    // Nothing moved.
    const row = await prisma.attendance.findUniqueOrThrow({ where: { id: checkIn.id } });
    expect(row.clockInAt?.toISOString()).toBe(at('09:40').toISOString());
    expect((await lateRow(emp.id))?.durationMinutes).toBe(40);
  });

  it('refuses an empty reason', async () => {
    const { checkIn } = await seed({ clockIn: '09:40', lateMinutes: 40 });
    const res = await correctAttendanceTime({
      attendanceId: checkIn.id,
      clockIn: '09:05',
      clockOut: '18:00',
      reason: '   ',
    });
    expect(res.ok).toBe(false);
  });

  it('refuses a clock-out at or before the clock-in', async () => {
    const { checkIn } = await seed({ clockIn: '09:40' });
    const res = await correctAttendanceTime({
      attendanceId: checkIn.id,
      clockIn: '10:00',
      clockOut: '09:00',
      reason: 'พิมพ์ผิด',
    });
    expect(res.ok).toBe(false);
  });

  it('writes no audit row when it refuses', async () => {
    const { checkIn } = await seed({ clockIn: '09:40' });
    await correctAttendanceTime({
      attendanceId: checkIn.id,
      clockIn: '09:05',
      clockOut: '18:00',
      reason: '',
    });
    expect(await prisma.auditLog.count({ where: { action: 'attendance.correct-time' } })).toBe(0);
  });
});
