import { Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { computeLiveLeaveCharges, recomputeLeaveCharges } from '@/lib/leave/recompute';

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
  await prisma.holiday.deleteMany({}); // @unique date — must clear between cases

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

/**
 * Direct coverage of `computeLiveLeaveCharges` — the orchestration that turns
 * stored leave rows + the CURRENT entitlement into the live charge/over-quota/
 * deduction. These pin the time-critical (calendar fill) and money-critical
 * (entitlement resolution + rate) edges that the pure unit tests can't reach.
 * Fixture rate is ฿1.00/min (12,600 / 30 / 420) so ฿ == over-quota minutes.
 */
describe('computeLiveLeaveCharges', () => {
  const STD = 420; // 09:00–12:00 (180) + 13:00–17:00 (240)
  const MORNING = 180;
  const deductType = () =>
    prisma.leaveType.create({
      data: { name: `ลากิจ-${uid().slice(0, 8)}`, overQuotaPolicy: 'DeductPay', annualQuota: 5 },
    });
  const grant = (
    employeeId: string,
    leaveTypeId: string,
    periodYear: number,
    grantedMinutes: number,
    carryoverMinutes = 0,
    adjustmentMinutes = 0,
  ) =>
    prisma.leaveEntitlement.create({
      data: {
        employeeId,
        leaveTypeId,
        periodYear,
        grantedMinutes,
        carryoverMinutes,
        adjustmentMinutes,
      },
    });
  const charge = (cs: Awaited<ReturnType<typeof computeLiveLeaveCharges>>, id: string) => {
    const c = cs.find((x) => x.leaveRequestId === id);
    if (!c) throw new Error(`no live charge for ${id}`);
    return c;
  };

  it('fills a HALF-DAY null chargedMinutes from the morning window, then prices the over-quota', async () => {
    const emp = await makeEmployee();
    const lt = await deductType();
    await grant(emp.id, lt.id, YEAR, 0); // zero quota → all over
    const r = await prisma.leaveRequest.create({
      data: {
        employeeId: emp.id,
        leaveTypeId: lt.id,
        startDate: day(8), // Mon — a working day
        endDate: day(8),
        unit: 'HalfMorning',
        reason: 'half',
        status: 'Approved',
        chargedMinutes: null, // must be filled to the morning window
        reviewedAt: new Date('2026-06-08T01:00:00Z'),
      },
    });

    const c = charge(await computeLiveLeaveCharges([emp.id]), r.id);
    expect(c.chargedMinutes).toBe(MORNING); // 180, not a full day
    expect(c.overQuotaMinutes).toBe(MORNING);
    expect(c.deductAmount).toBe(180); // 180 min × ฿1.00
  });

  it('fills a MULTI-DAY null chargedMinutes excluding Sundays and a weekday holiday', async () => {
    const emp = await makeEmployee();
    const lt = await deductType();
    await grant(emp.id, lt.id, YEAR, 0);
    await prisma.holiday.create({ data: { date: day(8), name: 'หยุด' } }); // Mon holiday
    const r = await prisma.leaveRequest.create({
      data: {
        employeeId: emp.id,
        leaveTypeId: lt.id,
        startDate: day(6), // Sat
        endDate: day(13), // next Sat
        unit: 'FullDay',
        reason: 'week',
        status: 'Approved',
        chargedMinutes: null,
        reviewedAt: new Date('2026-06-06T01:00:00Z'),
      },
    });

    // Sat6, [Sun7 excl], [Mon8 holiday], Tue9, Wed10, Thu11, Fri12, Sat13 = 6 days.
    const c = charge(await computeLiveLeaveCharges([emp.id]), r.id);
    expect(c.chargedMinutes).toBe(6 * STD); // 2520
    expect(c.overQuotaMinutes).toBe(6 * STD);
    expect(c.deductAmount).toBe(2520);
  });

  it('applies the วันหยุดชดเชย substitute: a Sunday holiday closes the following Monday', async () => {
    const emp = await makeEmployee();
    const lt = await deductType();
    await grant(emp.id, lt.id, YEAR, 0);
    await prisma.holiday.create({ data: { date: day(7), name: 'หยุดวันอาทิตย์' } }); // Sun → sub Mon 8
    const r = await prisma.leaveRequest.create({
      data: {
        employeeId: emp.id,
        leaveTypeId: lt.id,
        startDate: day(6),
        endDate: day(13),
        unit: 'FullDay',
        reason: 'week',
        status: 'Approved',
        chargedMinutes: null,
        reviewedAt: new Date('2026-06-06T01:00:00Z'),
      },
    });

    // Without the substitute this would be 7 working days (2940); the Sunday
    // holiday auto-shifts to Mon 8, removing it → 6 days (2520).
    const c = charge(await computeLiveLeaveCharges([emp.id]), r.id);
    expect(c.chargedMinutes).toBe(6 * STD); // 2520, not 2940
  });

  it('isolates over-quota PER YEAR — 2025 usage does not consume the 2026 quota', async () => {
    const emp = await makeEmployee();
    const lt = await deductType();
    await grant(emp.id, lt.id, 2025, 100_000); // generous 2025
    await grant(emp.id, lt.id, 2026, 0); // empty 2026
    const y2025 = await prisma.leaveRequest.create({
      data: {
        employeeId: emp.id,
        leaveTypeId: lt.id,
        startDate: new Date(Date.UTC(2025, 5, 9)),
        endDate: new Date(Date.UTC(2025, 5, 9)),
        reason: '2025',
        status: 'Approved',
        chargedMinutes: 420,
        reviewedAt: new Date('2025-06-09T01:00:00Z'),
      },
    });
    const y2026 = await prisma.leaveRequest.create({
      data: {
        employeeId: emp.id,
        leaveTypeId: lt.id,
        startDate: day(9),
        endDate: day(9),
        reason: '2026',
        status: 'Approved',
        chargedMinutes: 420,
        reviewedAt: new Date('2026-06-09T01:00:00Z'),
      },
    });

    const cs = await computeLiveLeaveCharges([emp.id]);
    expect(charge(cs, y2025.id).overQuotaMinutes).toBe(0); // within the 2025 grant
    expect(charge(cs, y2026.id).overQuotaMinutes).toBe(420); // fully over the empty 2026 grant
    expect(charge(cs, y2026.id).deductAmount).toBe(420);
  });

  it('falls back to leaveType.annualQuota × stdDay when no entitlement row exists', async () => {
    const emp = await makeEmployee();
    const lt = await prisma.leaveType.create({
      data: { name: `ลากิจ-${uid().slice(0, 8)}`, overQuotaPolicy: 'DeductPay', annualQuota: 1 },
    });
    // NO leaveEntitlement → granted falls back to 1 day = 420 min.
    const a = await prisma.leaveRequest.create({
      data: {
        employeeId: emp.id,
        leaveTypeId: lt.id,
        startDate: day(3),
        endDate: day(3),
        reason: 'first',
        status: 'Approved',
        chargedMinutes: 420, // consumes the whole fallback quota
        reviewedAt: new Date('2026-06-03T01:00:00Z'),
      },
    });
    const b = await prisma.leaveRequest.create({
      data: {
        employeeId: emp.id,
        leaveTypeId: lt.id,
        startDate: day(5),
        endDate: day(5),
        reason: 'second',
        status: 'Approved',
        chargedMinutes: 60, // entirely over the (now exhausted) fallback quota
        reviewedAt: new Date('2026-06-05T01:00:00Z'),
      },
    });

    const cs = await computeLiveLeaveCharges([emp.id]);
    expect(charge(cs, a.id).overQuotaMinutes).toBe(0);
    expect(charge(cs, b.id).overQuotaMinutes).toBe(60);
    expect(charge(cs, b.id).deductAmount).toBe(60);
  });

  it('resolves the base as granted + carryover + adjustment (negative adjustment shrinks it)', async () => {
    const emp = await makeEmployee();
    const lt = await deductType();
    await grant(emp.id, lt.id, YEAR, 420, 0, -420); // base = 420 + 0 − 420 = 0
    const r = await prisma.leaveRequest.create({
      data: {
        employeeId: emp.id,
        leaveTypeId: lt.id,
        startDate: day(9),
        endDate: day(9),
        reason: 'adj',
        status: 'Approved',
        chargedMinutes: 420,
        reviewedAt: new Date('2026-06-09T01:00:00Z'),
      },
    });

    const c = charge(await computeLiveLeaveCharges([emp.id]), r.id);
    expect(c.overQuotaMinutes).toBe(420); // base 0 → the whole day is over
    expect(c.deductAmount).toBe(420);
  });
});
