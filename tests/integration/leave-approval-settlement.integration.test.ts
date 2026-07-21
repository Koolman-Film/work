/**
 * Integration tests for the leave-approval half of the settled-penalty
 * defect (the other half — `voidAttendance` — is covered by
 * void-attendance-settlement.integration.test.ts, which this file mirrors).
 *
 * `computeLatePenalty` (src/lib/payroll/calc.ts) exempts a severe late whose
 * date is in `leaveDates` from its 1-day penalty — intentional, and this
 * change does not touch that. The defect is that the exemption can strike
 * RETROACTIVELY: if a SevereLate penalty was already settled with leave
 * entitlement for a payroll month, and that month has since left Draft
 * (money frozen — isPeriodClosed, penalty-settlement-admin.ts), approving a
 * leave request that covers one of that penalty's dates would drop the
 * actual SevereLate day count to zero on the next recompute, and
 * `clearPenaltySettlement` refuses a closed period forever — the leave the
 * employee already paid for the penalty is gone with no way back.
 *
 * `approveLeaveRequest` (src/lib/leave/admin.ts) must refuse that approval.
 * The guard is scoped to `kind: 'SevereLate'` only — a settled Absent in the
 * same published month must NOT be refused (a false block on ordinary
 * month-end leave processing).
 *
 * Mocks required because both `admin.ts` and `penalty-settlement-admin.ts`
 * are Next.js Server Actions — same pattern as
 * void-attendance-settlement.integration.test.ts:
 *   - `@/lib/auth/check-permission` → requirePermission/getUserAssignments:
 *     bypasses Supabase session, grants a global (superadmin) actor so
 *     branch-scope always passes regardless of which branch the test
 *     employee is on.
 *   - `next/headers` → headers(): both actions read request headers
 *     (IP/user-agent) that don't exist outside a real Next.js request.
 *   - `@/lib/inngest/events` → sendNotification: approveLeaveRequest fires a
 *     LINE push notification after the tx commits; there is no real Inngest
 *     client in the test environment.
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

vi.mock('@/lib/inngest/events', () => ({
  sendNotification: vi.fn(async () => undefined),
}));

import { Prisma } from '@prisma/client';
// Import AFTER vi.mock hoisting.
import { approveLeaveRequest } from '@/lib/leave/admin';
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

  // severeLateEnabled/severeLateThresholdMin left at schema defaults
  // (true / 30) — a 45-minute late below is "severe" without any extra config.
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
      allowFullDay: true,
    },
  });
}

/** A severe-late attendance row (45min > the 30min default threshold) inside
 *  the default 2026-07 cutoff window (cutoffDay 25 → 2026-06-26..2026-07-25)
 *  — this is the SevereLate penalty we'll settle with leave. */
async function makeSevereLate(employeeId: string, date = '2026-07-01') {
  return prisma.attendance.create({
    data: {
      employeeId,
      date: new Date(date),
      type: 'Late',
      durationMinutes: 45,
      source: 'Manual',
      createdById: uid(),
    },
  });
}

async function makeAbsence(employeeId: string, date = '2026-07-08') {
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

/** A Pending FullDay leave request covering exactly one date, written
 *  directly (mirrors how adminCreateLeaveRequest / worker submission land a
 *  row — approveLeaveRequest itself is the function under test). */
async function makePendingLeaveRequest(employeeId: string, leaveTypeId: string, date: string) {
  return prisma.leaveRequest.create({
    data: {
      employeeId,
      leaveTypeId,
      startDate: new Date(date),
      endDate: new Date(date),
      unit: 'FullDay',
      reason: 'ทดสอบ',
      status: 'Pending',
    },
  });
}

beforeEach(reset);
afterAll(async () => {
  await prisma.$disconnect();
});

describe('approveLeaveRequest — refuses to strand a settled SevereLate (Defect 2)', () => {
  it('refuses to approve leave over a date whose SevereLate is settled once the month is published', async () => {
    const emp = await makeEmployee();
    const vacation = await makeVacationType();
    await makeSevereLate(emp.id, '2026-07-01');

    const settled = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'SevereLate',
      leaveTypeId: vacation.id,
      days: 1,
      via: 'reconcile',
    });
    expect(settled).toEqual({ ok: true });

    await runPayrollDraft('2026-07');
    const published = await publishPayroll('2026-07', { employeeId: emp.id });
    expect(published.published).toHaveLength(1);

    const leaveReq = await makePendingLeaveRequest(emp.id, vacation.id, '2026-07-01');
    const result = await approveLeaveRequest({ leaveRequestId: leaveReq.id, note: 'อนุมัติทดสอบ' });

    expect(result).toEqual({
      ok: false,
      code: 'settlement-closed',
      message: expect.any(String),
    });

    // Nothing was written — the request must still be Pending, no OnLeave
    // rows created, and the settlement (and the leave it consumed) untouched.
    const row = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: leaveReq.id } });
    expect(row.status).toBe('Pending');

    const onLeaveRows = await prisma.attendance.findMany({
      where: { employeeId: emp.id, type: 'OnLeave' },
    });
    expect(onLeaveRows).toHaveLength(0);

    const settlement = await prisma.attendancePenaltySettlement.findUnique({
      where: {
        employeeId_month_kind: { employeeId: emp.id, month: '2026-07', kind: 'SevereLate' },
      },
    });
    expect(settlement?.deletedAt).toBeNull();
    expect(settlement?.days.toNumber()).toBe(1);
  });

  it('still allows the same approval while the payroll month is Draft', async () => {
    const emp = await makeEmployee();
    const vacation = await makeVacationType();
    await makeSevereLate(emp.id, '2026-07-01');

    const settled = await setPenaltySettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'SevereLate',
      leaveTypeId: vacation.id,
      days: 1,
      via: 'reconcile',
    });
    expect(settled).toEqual({ ok: true });

    // A Draft row exists (the reconcile page's normal state before
    // publishing) — the approval must still be permitted here.
    await runPayrollDraft('2026-07');
    const draftRow = await prisma.payroll.findFirstOrThrow({
      where: { employeeId: emp.id, month: '2026-07' },
    });
    expect(draftRow.status).toBe('Draft');

    const leaveReq = await makePendingLeaveRequest(emp.id, vacation.id, '2026-07-01');
    const result = await approveLeaveRequest({ leaveRequestId: leaveReq.id, note: 'อนุมัติทดสอบ' });

    expect(result).toEqual({
      ok: true,
      attendanceRowsCreated: 1,
      workingDays: 1,
    });

    const row = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: leaveReq.id } });
    expect(row.status).toBe('Approved');
  });

  it('allows approving leave for an employee with a settled Absent (not SevereLate) in a published month', async () => {
    const emp = await makeEmployee();
    const vacation = await makeVacationType();
    await makeAbsence(emp.id, '2026-07-08');

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

    // Leave on an unrelated date — the settled Absent must NOT block this:
    // `leaveDates` only ever exempts a SevereLate (computeLatePenalty), so
    // this approval cannot strand the Absent settlement no matter which
    // date it covers.
    const leaveReq = await makePendingLeaveRequest(emp.id, vacation.id, '2026-07-02');
    const result = await approveLeaveRequest({ leaveRequestId: leaveReq.id, note: 'อนุมัติทดสอบ' });

    expect(result).toEqual({
      ok: true,
      attendanceRowsCreated: 1,
      workingDays: 1,
    });
  });

  it('leaves a normal approval with no settlements anywhere unaffected', async () => {
    const emp = await makeEmployee();
    const vacation = await makeVacationType();

    const leaveReq = await makePendingLeaveRequest(emp.id, vacation.id, '2026-07-02');
    const result = await approveLeaveRequest({ leaveRequestId: leaveReq.id, note: 'อนุมัติทดสอบ' });

    expect(result).toEqual({
      ok: true,
      attendanceRowsCreated: 1,
      workingDays: 1,
    });
  });
});
