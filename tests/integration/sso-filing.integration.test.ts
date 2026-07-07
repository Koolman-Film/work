import { Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { loadSsoFiling } from '@/lib/filings/sso';

const MONTH = '2026-06';

async function reset() {
  // Delete children before employees/branches — this test DB is shared with
  // other integration files (see reports.integration.test.ts), so leftover
  // rows referencing employees (Attendance, LeaveRequest, etc.) must go first
  // or the employee/branch deletes hit FK constraint violations.
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
  await prisma.branch.deleteMany({});
  await prisma.payrollConfig.deleteMany({});
  await prisma.payrollConfig.create({
    data: {
      ssoRate: new Prisma.Decimal('0.05'),
      ssoSalaryCap: new Prisma.Decimal(15000),
      ssoAmountCap: new Prisma.Decimal(750),
      otMultiplier: new Prisma.Decimal('1.5'),
      absentDeductionPerDay: new Prisma.Decimal(500),
      lateDeduction: new Prisma.Decimal(100),
      earlyLeaveDeduction: new Prisma.Decimal(100),
    },
  });
}

async function makeEmp(
  branchId: string,
  over: { firstName?: string; hasSso?: boolean; nationalId?: string | null; status?: string },
) {
  const user = await prisma.user.create({ data: {} });
  return prisma.employee.create({
    data: {
      userId: user.id,
      firstName: over.firstName ?? 'สม',
      lastName: 'ชาย',
      // `??` would treat an explicit `null` (the "missing national ID" test
      // case) as absent and fall back to the default — use `in` to only
      // default when the key wasn't passed at all.
      nationalId: 'nationalId' in over ? over.nationalId : '1101700207289',
      branchId,
      salaryType: 'Monthly',
      baseSalary: new Prisma.Decimal(20000),
      hasSso: over.hasSso ?? true,
      status: (over.status as never) ?? 'Active',
      hiredAt: new Date('2026-01-01'),
    },
  });
}

async function makePayroll(employeeId: string, incomeBase: number, deductSso: number) {
  return prisma.payroll.create({
    data: {
      employeeId,
      month: MONTH,
      incomeBase: new Prisma.Decimal(incomeBase),
      netPay: new Prisma.Decimal(incomeBase - deductSso),
      deductSso: new Prisma.Decimal(deductSso),
      status: 'Published',
    },
  });
}

beforeEach(reset);
afterAll(async () => {
  await prisma.$disconnect();
});

describe('loadSsoFiling', () => {
  it('aggregates insured employees of the branch with wages/contribution + totals', async () => {
    const branch = await prisma.branch.create({ data: { name: 'HQ', ssoAccountNo: '1234567890' } });
    const e1 = await makeEmp(branch.id, { firstName: 'ก' });
    await makePayroll(e1.id, 20000, 750); // wage over cap → contribution capped at 750
    const filing = await loadSsoFiling(MONTH, branch.id);
    expect(filing).not.toBeNull();
    expect(filing?.rows).toHaveLength(1);
    expect(filing?.rows[0]).toMatchObject({ wages: 20000, employeeContribution: 750, employerContribution: 750 });
    expect(filing?.totals).toMatchObject({ wages: 20000, employee: 750, employer: 750, grand: 1500, count: 1 });
    expect(filing?.ratePercent).toBe(5);
    expect(filing?.problems).toEqual({ missingNationalIds: 0, missingBranchSso: false });
  });

  it('excludes non-SSO, archived, and other-branch employees', async () => {
    const branch = await prisma.branch.create({ data: { name: 'HQ', ssoAccountNo: 'X' } });
    const other = await prisma.branch.create({ data: { name: 'Other', ssoAccountNo: 'Y' } });
    const insured = await makeEmp(branch.id, {});
    const noSso = await makeEmp(branch.id, { hasSso: false });
    const archived = await makeEmp(branch.id, { status: 'Archived' });
    const otherBranch = await makeEmp(other.id, {});
    for (const e of [insured, noSso, archived, otherBranch]) await makePayroll(e.id, 20000, 750);
    const filing = await loadSsoFiling(MONTH, branch.id);
    expect(filing?.rows).toHaveLength(1);
    expect(filing?.rows[0]?.employeeId).toBe(insured.id);
  });

  it('flags missing national IDs and missing branch SSO number', async () => {
    const branch = await prisma.branch.create({ data: { name: 'HQ', ssoAccountNo: null } });
    const e = await makeEmp(branch.id, { nationalId: null });
    await makePayroll(e.id, 20000, 750);
    const filing = await loadSsoFiling(MONTH, branch.id);
    expect(filing?.problems).toEqual({ missingNationalIds: 1, missingBranchSso: true });
  });
});
