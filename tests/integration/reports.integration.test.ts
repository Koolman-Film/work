import { Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import {
  advanceDetail,
  advanceReport,
  attendanceReport,
  leaveDetail,
  leaveReport,
} from '@/lib/reports/queries';

/**
 * Integration tests (dedicated koolman_test DB) for the auth-free report
 * aggregations behind /admin/reports/*. These cover the parts no unit test can:
 *   - the branch/department EmployeeFilter (the report-filters feature)
 *   - usedMinutes sourced from LeaveRequest.chargedMinutes (the leave-report
 *     "0 used for an approved leave" bug — chargedMinutes was null)
 *   - the period windowing + status/soft-delete filtering of each groupBy
 */

const PERIOD = { from: '2026-06-01', to: '2026-06-30' };
const YEAR = 2026;

function uid(): string {
  return crypto.randomUUID();
}
/** A @db.Date UTC-midnight for a June 2026 day. */
function day(d: number): Date {
  return new Date(Date.UTC(2026, 5, d));
}

async function reset() {
  // Payroll/adjustments first — they FK employees, and other integration files
  // (payroll-pipeline) share this DB and may leave rows behind.
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
  await prisma.department.deleteMany({});
  await prisma.branch.deleteMany({});

  // advanceReport → advanceBalanceFor reads the PayrollConfig singleton (SSO
  // rates) for every employee, so a fresh DB needs one seeded. Deterministic
  // here rather than relying on another test file leaving one behind.
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

async function makeBranch() {
  return prisma.branch.create({ data: { name: `Branch-${uid().slice(0, 8)}` } });
}
async function makeDept() {
  return prisma.department.create({ data: { name: `Dept-${uid().slice(0, 8)}` } });
}

async function makeEmployee(opts: {
  firstName?: string;
  baseSalary?: number;
  branchId?: string;
  departmentId?: string | null;
}) {
  const user = await prisma.user.create({ data: {} });
  const branchId = opts.branchId ?? (await makeBranch()).id;
  return prisma.employee.create({
    data: {
      userId: user.id,
      firstName: opts.firstName ?? 'Test',
      lastName: 'Worker',
      branchId,
      departmentId: opts.departmentId ?? null,
      salaryType: 'Monthly',
      baseSalary: new Prisma.Decimal(opts.baseSalary ?? 20_000),
      status: 'Active',
      hiredAt: new Date('2026-01-01'),
    },
  });
}

beforeEach(reset);
afterAll(async () => {
  await prisma.$disconnect();
});

describe('advanceReport', () => {
  it('sums in-period approvals, all-time outstanding, and reflects availability', async () => {
    const emp = await makeEmployee({ baseSalary: 20_000 });
    await prisma.cashAdvance.createMany({
      data: [
        // in window, still outstanding → counts in both buckets, reserves balance
        {
          employeeId: emp.id,
          amount: new Prisma.Decimal(5_000),
          status: 'Approved',
          isDeducted: false,
          approvedAt: new Date('2026-06-10T03:00:00.000Z'),
        },
        // approved BEFORE the window + already deducted → neither bucket, not reserved
        {
          employeeId: emp.id,
          amount: new Prisma.Decimal(2_000),
          status: 'Approved',
          isDeducted: true,
          approvedAt: new Date('2026-05-01T03:00:00.000Z'),
        },
        // pending → never counts as approved/outstanding
        { employeeId: emp.id, amount: new Prisma.Decimal(9_999), status: 'Pending' },
      ],
    });

    const [row] = await advanceReport(PERIOD, {});
    expect(row?.approvedInPeriod).toBe(5_000);
    expect(row?.outstandingNow).toBe(5_000);
    // availableNow comes from advanceBalanceFor, which reserves BOTH Pending and
    // Approved-not-deducted (it's a forward-looking cap, unlike the buckets
    // above): 20_000 − (5_000 + 9_999) = 5_001.
    expect(row?.availableNow).toBe(5_001);
  });

  it('honours the branch filter', async () => {
    const b1 = await makeBranch();
    const b2 = await makeBranch();
    const a = await makeEmployee({ firstName: 'Ann', branchId: b1.id });
    await makeEmployee({ firstName: 'Bob', branchId: b2.id });

    const all = await advanceReport(PERIOD, {});
    expect(all).toHaveLength(2);

    const onlyB1 = await advanceReport(PERIOD, { branchId: b1.id });
    expect(onlyB1).toHaveLength(1);
    expect(onlyB1[0]?.employeeId).toBe(a.id);
  });
});

describe('attendanceReport', () => {
  async function mark(employeeId: string, type: string, d: number, minutes?: number) {
    return prisma.attendance.create({
      data: {
        employeeId,
        date: day(d),
        type: type as 'Late' | 'EarlyLeave' | 'Absent',
        source: 'Manual',
        durationMinutes: minutes ?? null,
        createdById: uid(),
      },
    });
  }

  it('aggregates late/early/absent counts + minutes and approved OT, within the period', async () => {
    const dept = await makeDept();
    const emp = await makeEmployee({ departmentId: dept.id });
    await mark(emp.id, 'Late', 5, 30);
    await mark(emp.id, 'Late', 6, 15);
    await mark(emp.id, 'EarlyLeave', 7, 20);
    await mark(emp.id, 'Absent', 8);
    // A Late row OUTSIDE the June window (July 1) — must be excluded entirely.
    await prisma.attendance.create({
      data: {
        employeeId: emp.id,
        date: new Date(Date.UTC(2026, 6, 1)),
        type: 'Late',
        source: 'Manual',
        durationMinutes: 999,
        createdById: uid(),
      },
    });
    await prisma.overtimeEntry.create({
      data: {
        employeeId: emp.id,
        date: day(9),
        minutes: 90,
        rateType: 'PerHourAmount',
        ratePerHour: new Prisma.Decimal(50),
        computedAmount: new Prisma.Decimal(75),
        status: 'Approved',
        createdById: uid(),
      },
    });

    const [row] = await attendanceReport(PERIOD, { departmentId: dept.id });
    expect(row?.lateCount).toBe(2); // June 5 + June 6 (July 1 excluded)
    expect(row?.lateMinutes).toBe(45); // 30 + 15
    expect(row?.earlyCount).toBe(1);
    expect(row?.earlyMinutes).toBe(20);
    expect(row?.absentDays).toBe(1);
    expect(row?.otMinutes).toBe(90);
  });

  it('honours the department filter', async () => {
    const d1 = await makeDept();
    const d2 = await makeDept();
    const e1 = await makeEmployee({ departmentId: d1.id });
    await makeEmployee({ departmentId: d2.id });

    const rows = await attendanceReport(PERIOD, { departmentId: d1.id });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.employeeId).toBe(e1.id);
  });
});

describe('leaveReport', () => {
  it('reports usedMinutes from chargedMinutes for Approved requests (the bug fix)', async () => {
    const emp = await makeEmployee({});
    const lt = await prisma.leaveType.create({
      data: { name: `ลาป่วย-${uid().slice(0, 8)}`, annualQuota: 30, isPaid: true },
    });
    // Approved + chargedMinutes set → contributes its minutes
    await prisma.leaveRequest.create({
      data: {
        employeeId: emp.id,
        leaveTypeId: lt.id,
        startDate: day(3),
        endDate: day(3),
        chargedMinutes: 420,
        overQuotaMinutes: 60,
        deductAmount: new Prisma.Decimal(250),
        reason: 'sick',
        status: 'Approved',
      },
    });
    // Approved but chargedMinutes null → must not break the _sum (contributes 0)
    await prisma.leaveRequest.create({
      data: {
        employeeId: emp.id,
        leaveTypeId: lt.id,
        startDate: day(4),
        endDate: day(4),
        chargedMinutes: null,
        reason: 'sick (legacy null)',
        status: 'Approved',
      },
    });
    // Pending → excluded by the status filter
    await prisma.leaveRequest.create({
      data: {
        employeeId: emp.id,
        leaveTypeId: lt.id,
        startDate: day(5),
        endDate: day(5),
        chargedMinutes: 999,
        reason: 'not approved',
        status: 'Pending',
      },
    });

    const { rows, types } = await leaveReport(PERIOD, {}, YEAR);
    expect(types.some((t) => t.id === lt.id)).toBe(true);
    const cell = rows[0]?.byType[lt.id];
    expect(cell?.usedMinutes).toBe(420); // 420 + null + (pending excluded)
    // DeductPay over-quota/deduction is DERIVED live: this employee is well
    // within the 30-day quota, so the live values are 0 — the stale stored
    // snapshot (60 min / ฿250) is correctly ignored, matching "remaining".
    expect(cell?.overQuotaMinutes).toBe(0);
    expect(cell?.deductAmount).toBe(0);
    // 30-day quota × 7h/day standard ... remaining is reported; just assert it's tracked.
    expect(rows[0]?.remainingByType[lt.id]).not.toBeUndefined();
  });

  it('honours the branch filter and zero-fills employees with no leave', async () => {
    const b1 = await makeBranch();
    const b2 = await makeBranch();
    const a = await makeEmployee({ firstName: 'Ann', branchId: b1.id });
    await makeEmployee({ firstName: 'Bob', branchId: b2.id });
    const lt = await prisma.leaveType.create({
      data: { name: `ลากิจ-${uid().slice(0, 8)}`, annualQuota: 10 },
    });

    const { rows } = await leaveReport(PERIOD, { branchId: b1.id }, YEAR);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.employeeId).toBe(a.id);
    // no requests → cell zero-filled, not absent
    expect(rows[0]?.byType[lt.id]).toEqual({
      usedMinutes: 0,
      overQuotaMinutes: 0,
      deductAmount: 0,
    });
  });
});

describe('advanceDetail (drill-down)', () => {
  it('lists in-period approved advances per employee, excluding pending/out-of-period', async () => {
    const emp = await makeEmployee({});
    await prisma.cashAdvance.createMany({
      data: [
        {
          employeeId: emp.id,
          amount: new Prisma.Decimal(5_000),
          status: 'Approved',
          isDeducted: false,
          approvedAt: new Date('2026-06-10T03:00:00.000Z'),
        },
        {
          employeeId: emp.id,
          amount: new Prisma.Decimal(2_000),
          status: 'Approved',
          isDeducted: true,
          approvedAt: new Date('2026-06-20T03:00:00.000Z'),
        },
        // out of period
        {
          employeeId: emp.id,
          amount: new Prisma.Decimal(9_999),
          status: 'Approved',
          approvedAt: new Date('2026-05-01T03:00:00.000Z'),
        },
        // pending
        { employeeId: emp.id, amount: new Prisma.Decimal(8_888), status: 'Pending' },
      ],
    });

    const detail = await advanceDetail(PERIOD, {});
    const items = detail[emp.id] ?? [];
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.amount).sort((a, b) => a - b)).toEqual([2_000, 5_000]);
    expect(items.find((i) => i.amount === 2_000)?.isDeducted).toBe(true);
  });
});

describe('leaveDetail (drill-down)', () => {
  it('lists in-period approved leave per employee with type + range, excluding pending', async () => {
    const emp = await makeEmployee({});
    const lt = await prisma.leaveType.create({
      data: { name: `ลาป่วย-${uid().slice(0, 8)}`, annualQuota: 30 },
    });
    await prisma.leaveRequest.create({
      data: {
        employeeId: emp.id,
        leaveTypeId: lt.id,
        startDate: day(3),
        endDate: day(4),
        chargedMinutes: 840,
        overQuotaMinutes: 0,
        reason: 'sick',
        status: 'Approved',
      },
    });
    // pending → excluded
    await prisma.leaveRequest.create({
      data: {
        employeeId: emp.id,
        leaveTypeId: lt.id,
        startDate: day(10),
        endDate: day(10),
        chargedMinutes: 420,
        reason: 'pending',
        status: 'Pending',
      },
    });

    const detail = await leaveDetail(PERIOD, {});
    const items = detail[emp.id] ?? [];
    expect(items).toHaveLength(1);
    expect(items[0]?.leaveTypeName).toBe(lt.name);
    expect(items[0]?.chargedMinutes).toBe(840);
    expect(items[0]?.startDate.toISOString().slice(0, 10)).toBe('2026-06-03');
    expect(items[0]?.endDate.toISOString().slice(0, 10)).toBe('2026-06-04');
  });
});
