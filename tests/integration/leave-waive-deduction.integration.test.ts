/**
 * Integration coverage for waiveLeaveDeduction against a REAL Postgres.
 *
 * The behaviours that matter for money and for the audit trail:
 *   - the deduction actually falls (derive-on-read picks the waiver up);
 *   - `overQuotaMinutes` is NOT rewritten, so the record still says how far
 *     over quota the employee was;
 *   - an audit row records who forgave what, and how much of it;
 *   - a swept (paid) request is refused — that money is frozen;
 *   - a waiver survives a leave-type correction, which rewrites sibling
 *     deductions and would otherwise silently re-charge it.
 */

import { Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db/prisma';

const actor = { id: '11111111-1111-4111-8111-111111111111' };

vi.mock('@/lib/auth/check-permission', () => ({
  requirePermission: vi.fn(async () => ({
    user: actor,
    authUserId: actor.id,
    tier: 'Admin',
  })),
  // Branch scope resolves through getPermittedBranches -> getUserAssignments.
  // A global superadmin grant makes `permitted = 'all'`, so the gate passes
  // whichever branch the seeded employee lands on. Mirrors
  // penalty-settlement.integration.test.ts.
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

// waiveLeaveDeduction records request IP / user-agent, which do not exist
// outside a real Next.js request context.
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => ({ get: (_n: string) => null })),
}));

const { waiveLeaveDeduction } = await import('@/lib/leave/waive-deduction');
const { computeLiveLeaveCharges } = await import('@/lib/leave/recompute');

const uid = () => crypto.randomUUID();
const STD = 420;

async function reset() {
  await prisma.auditLog.deleteMany({});
  await prisma.payroll.deleteMany({});
  await prisma.leaveRequest.deleteMany({});
  await prisma.leaveEntitlement.deleteMany({});
  await prisma.leaveType.deleteMany({});
  await prisma.employee.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.branch.deleteMany({});
  await prisma.leaveConfig.deleteMany({});
  await prisma.payrollConfig.deleteMany({});
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
    },
  });
}

/** ฿13,500/month, 30 working days → ฿450 per over-quota day, like the row that
 *  started this: a leave debt bigger than the salary it comes out of. */
async function seed() {
  const user = await prisma.user.create({ data: {} });
  const branch = await prisma.branch.create({ data: { name: `B-${uid().slice(0, 8)}` } });
  const emp = await prisma.employee.create({
    data: {
      userId: user.id,
      firstName: 'Eve',
      lastName: 'Overdrawn',
      branchId: branch.id,
      salaryType: 'Monthly',
      baseSalary: new Prisma.Decimal(13_500),
      status: 'Active',
      hiredAt: new Date('2026-01-01'),
    },
  });
  const leaveType = await prisma.leaveType.create({
    data: { name: `ลากิจ-${uid().slice(0, 8)}`, annualQuota: 0 },
  });
  const leave = await prisma.leaveRequest.create({
    data: {
      employeeId: emp.id,
      leaveTypeId: leaveType.id,
      startDate: new Date('2026-02-02'),
      endDate: new Date('2026-04-30'),
      unit: 'FullDay',
      reason: 'backlog',
      status: 'Approved',
      chargedMinutes: 61 * STD,
      reviewedAt: new Date('2026-02-01'),
    },
  });
  return { emp, leaveType, leave };
}

const chargeFor = async (id: string) =>
  (await computeLiveLeaveCharges()).find((c) => c.leaveRequestId === id);

beforeEach(reset);
afterAll(async () => {
  await prisma.$disconnect();
});

describe('waiveLeaveDeduction', () => {
  it('drops the deduction, keeps the over-quota factual, and audits who forgave what', async () => {
    const { leave } = await seed();

    const before = await chargeFor(leave.id);
    expect(before?.overQuotaMinutes).toBe(61 * STD);
    expect(before?.deductAmount).toBeCloseTo(27_450, 0); // 61 × ฿450

    const res = await waiveLeaveDeduction({
      leaveRequestId: leave.id,
      waiveMinutes: 61 * STD,
      reason: 'บันทึกวันที่ผิด — ยกเว้นทั้งหมด',
    });
    expect(res).toEqual({ ok: true });

    const after = await chargeFor(leave.id);
    // The charge is gone…
    expect(after?.deductAmount).toBeNull();
    // …but the record still says she was 61 days over quota.
    expect(after?.overQuotaMinutes).toBe(61 * STD);

    const row = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: leave.id } });
    expect(row.waivedOverQuotaMinutes).toBe(61 * STD);
    expect(row.waivedById).toBe(actor.id);
    expect(row.waiveReason).toBe('บันทึกวันที่ผิด — ยกเว้นทั้งหมด');

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: 'LeaveRequest', entityId: leave.id, action: 'leave.waive-deduction' },
    });
    expect(audit.actorId).toBe(actor.id);
    expect(audit.beforeValue).toMatchObject({ waivedOverQuotaMinutes: 0 });
    expect(audit.afterValue).toMatchObject({
      waivedOverQuotaMinutes: 61 * STD,
      overQuotaMinutes: 61 * STD,
      waiveReason: 'บันทึกวันที่ผิด — ยกเว้นทั้งหมด',
    });
  });

  it('forgives only part when asked, and clamps a too-large waiver', async () => {
    const { leave } = await seed();

    await waiveLeaveDeduction({
      leaveRequestId: leave.id,
      waiveMinutes: 31 * STD,
      reason: 'ครึ่งหนึ่ง',
    });
    // 61 − 31 = 30 days still charged → ฿13,500.
    expect((await chargeFor(leave.id))?.deductAmount).toBeCloseTo(13_500, 0);

    await waiveLeaveDeduction({
      leaveRequestId: leave.id,
      waiveMinutes: 999_999,
      reason: 'ยกเว้นที่เหลือ',
    });
    const row = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: leave.id } });
    // Clamped to what was actually over quota — a waiver can never pay her.
    expect(row.waivedOverQuotaMinutes).toBe(61 * STD);
    expect((await chargeFor(leave.id))?.deductAmount).toBeNull();
  });

  it('refuses a request already swept into a published payroll', async () => {
    const { emp, leave } = await seed();
    const payroll = await prisma.payroll.create({
      data: {
        employeeId: emp.id,
        month: '2026-07',
        status: 'Published',
        incomeBase: new Prisma.Decimal(0),
        netPay: new Prisma.Decimal(0),
      },
    });
    await prisma.leaveRequest.update({
      where: { id: leave.id },
      data: { deductedInPayrollId: payroll.id },
    });

    const res = await waiveLeaveDeduction({
      leaveRequestId: leave.id,
      waiveMinutes: 420,
      reason: 'too late',
    });
    expect(res).toEqual({ ok: false, message: 'จ่ายแล้ว — แก้ไขไม่ได้' });
    const row = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: leave.id } });
    expect(row.waivedOverQuotaMinutes).toBe(0);
  });

  it('requires a reason — an unexplained forgiveness of salary is the thing the trail exists to prevent', async () => {
    const { leave } = await seed();
    expect(
      await waiveLeaveDeduction({ leaveRequestId: leave.id, waiveMinutes: 420, reason: '  ' }),
    ).toEqual({ ok: false, message: 'กรุณาระบุเหตุผล' });
  });

  it('setting the waiver back to 0 restores the charge and clears the reason', async () => {
    const { leave } = await seed();
    await waiveLeaveDeduction({ leaveRequestId: leave.id, waiveMinutes: 61 * STD, reason: 'oops' });
    expect((await chargeFor(leave.id))?.deductAmount).toBeNull();

    await waiveLeaveDeduction({
      leaveRequestId: leave.id,
      waiveMinutes: 0,
      reason: 'ยกเลิกการยกเว้น',
    });
    expect((await chargeFor(leave.id))?.deductAmount).toBeCloseTo(27_450, 0);
    const row = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: leave.id } });
    expect(row.waiveReason).toBeNull();
    expect(row.waivedAt).toBeNull();
  });
});
