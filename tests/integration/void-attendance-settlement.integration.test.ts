/**
 * Integration tests for Defect 1 (merge blocker): `voidAttendance`
 * (src/lib/attendance/void.ts) must refuse to void an attendance row when
 * doing so would permanently strand a live penalty settlement — once the
 * row's payroll month has left Draft, money is frozen (isPeriodClosed,
 * penalty-settlement-admin.ts) but the leave already spent has no path back
 * (clearPenaltySettlement also refuses a closed period), so the void must be
 * refused instead of silently destroying the employee's leave day.
 *
 * While the month is still Draft, the void must still be allowed — the admin
 * can fix the settlement on the reconcile page, and publishPayroll's own
 * stranded-settlement guard (run.ts) catches it if they forget.
 *
 * Mocks required because both `void.ts` and `penalty-settlement-admin.ts`
 * are Next.js Server Actions — same pattern as
 * penalty-settlement.integration.test.ts:
 *   - `@/lib/auth/check-permission` → requirePermission/getUserAssignments:
 *     bypasses Supabase session, grants a global (superadmin) actor so
 *     branch-scope always passes regardless of which branch the test
 *     employee is on.
 *   - `next/headers` → headers(): both actions read request headers
 *     (IP/user-agent) that don't exist outside a real Next.js request.
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
  headers: vi.fn(async () => ({
    get: (_name: string) => null,
  })),
}));

import { Prisma } from '@prisma/client';
// Import AFTER vi.mock hoisting.
import { voidAttendance } from '@/lib/attendance/void';
import { setPenaltySettlement } from '@/lib/payroll/penalty-settlement-admin';
import { publishPayroll, runPayrollDraft } from '@/lib/payroll/run';

function uid(): string {
  return crypto.randomUUID();
}

async function reset() {
  await prisma.attendancePenaltySettlement.deleteMany({});
  await prisma.payroll.deleteMany({});
  await prisma.overtimeEntry.deleteMany({});
  await prisma.attendance.deleteMany({});
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

async function makeVacationType() {
  return prisma.leaveType.create({
    data: {
      name: `ลาพักร้อน-${uid().slice(0, 8)}`,
      annualQuota: 10,
      penaltySettlementAllowed: true,
    },
  });
}

/** One Absent attendance row inside the default 2026-07 cutoff window
 *  (cutoffDay 25 → 2026-06-26..2026-07-25) — the row we'll try to void. */
async function makeAbsence(employeeId: string, date = '2026-07-01') {
  return prisma.attendance.create({
    data: {
      employeeId,
      date: new Date(date),
      type: 'Absent',
      source: 'Manual',
      createdById: uid(),
    },
  });
}

beforeEach(reset);
afterAll(async () => {
  await prisma.$disconnect();
});

describe('voidAttendance — refuses to strand a settlement (Defect 1)', () => {
  it('refuses to void a settled Absent row once its payroll month is published', async () => {
    const emp = await makeEmployee();
    const vacation = await makeVacationType();
    const absence = await makeAbsence(emp.id);

    const settled = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 1,
      via: 'reconcile',
    });
    expect(settled).toEqual({ ok: true });

    await runPayrollDraft('2026-07');
    const published = await publishPayroll('2026-07', { employeeId: emp.id });
    expect(published.published).toHaveLength(1);

    const result = await voidAttendance(absence.id, 'บันทึกผิด ขาดงานไม่จริง');

    expect(result).toEqual({
      ok: false,
      code: 'settlement-closed',
      message: expect.any(String),
    });

    // Nothing was written — the row must still be live, and the settlement
    // (and the leave it consumed) must still be there, untouched.
    const row = await prisma.attendance.findUniqueOrThrow({ where: { id: absence.id } });
    expect(row.deletedAt).toBeNull();

    const settlement = await prisma.attendancePenaltySettlement.findUnique({
      where: {
        employeeId_month_kind: { employeeId: emp.id, month: '2026-07', kind: 'Absent' },
      },
    });
    expect(settlement?.deletedAt).toBeNull();
    expect(settlement?.days.toNumber()).toBe(1);
  });

  it('still allows the void while the payroll month is Draft', async () => {
    const emp = await makeEmployee();
    const vacation = await makeVacationType();
    const absence = await makeAbsence(emp.id);

    const settled = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 1,
      via: 'reconcile',
    });
    expect(settled).toEqual({ ok: true });

    // A Draft row exists (the reconcile page's normal state before
    // publishing) — the void must still be permitted here so the admin can
    // fix the now-wrong settlement on the reconcile page afterward.
    await runPayrollDraft('2026-07');
    const draftRow = await prisma.payroll.findFirstOrThrow({
      where: { employeeId: emp.id, month: '2026-07' },
    });
    expect(draftRow.status).toBe('Draft');

    const result = await voidAttendance(absence.id, 'บันทึกผิด ขาดงานไม่จริง');
    expect(result).toEqual({ ok: true });

    const row = await prisma.attendance.findUniqueOrThrow({ where: { id: absence.id } });
    expect(row.deletedAt).not.toBeNull();
  });

  it('still allows the void when no Payroll row exists yet for the month at all', async () => {
    const emp = await makeEmployee();
    const vacation = await makeVacationType();
    const absence = await makeAbsence(emp.id);

    const settled = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 1,
      via: 'reconcile',
    });
    expect(settled).toEqual({ ok: true });

    // Never ran "คำนวณ" — the manual attendance form lets an admin settle a
    // penalty before any Draft row exists (see penalty-settlement.integration
    // test's "zero-row race" test for the same precondition). No Payroll row
    // at all must not be mistaken for "closed".
    const before = await prisma.payroll.findFirst({
      where: { employeeId: emp.id, month: '2026-07' },
    });
    expect(before).toBeNull();

    const result = await voidAttendance(absence.id, 'บันทึกผิด ขาดงานไม่จริง');
    expect(result).toEqual({ ok: true });
  });

  it('still voids a row with no settlement at all, in a published month', async () => {
    const emp = await makeEmployee();
    // No settlement anywhere — a healthy void must be completely unaffected
    // by Defect 1's new guard.
    const late = await prisma.attendance.create({
      data: {
        employeeId: emp.id,
        date: new Date('2026-07-02'),
        type: 'Late',
        durationMinutes: 5,
        source: 'Manual',
        createdById: uid(),
      },
    });

    await runPayrollDraft('2026-07');
    await publishPayroll('2026-07', { employeeId: emp.id });

    const result = await voidAttendance(late.id, 'แก้ไขเวลาผิด');
    expect(result).toEqual({ ok: true });

    const row = await prisma.attendance.findUniqueOrThrow({ where: { id: late.id } });
    expect(row.deletedAt).not.toBeNull();
  });
});
