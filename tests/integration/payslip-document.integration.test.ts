// tests/integration/payslip-document.integration.test.ts
import { Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { getPayslipDocument } from '@/lib/payslip/document';

const MONTH = '2026-06';

async function reset() {
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
  await prisma.branch.deleteMany({});
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
beforeEach(reset);
afterAll(async () => {
  await prisma.$disconnect();
});

async function makeEmp() {
  const user = await prisma.user.create({ data: {} });
  const branch = await prisma.branch.create({ data: { name: 'Chiang Mai' } });
  return prisma.employee.create({
    data: {
      userId: user.id,
      firstName: 'Somchai',
      lastName: 'Jaidee',
      nickname: 'สมชาย',
      branchId: branch.id,
      salaryType: 'Monthly',
      baseSalary: new Prisma.Decimal(12_600),
      status: 'Active',
      hiredAt: new Date('2026-01-01'),
    },
  });
}

describe('getPayslipDocument', () => {
  it('returns null when no published payroll exists', async () => {
    const emp = await makeEmp();
    expect(await getPayslipDocument(emp.id, MONTH)).toBeNull();
  });

  it('assembles income/deduction lines with SSO + leave + advance details', async () => {
    const emp = await makeEmp();
    const payroll = await prisma.payroll.create({
      data: {
        employeeId: emp.id,
        month: MONTH,
        status: 'Published',
        publishedAt: new Date(),
        incomeBase: new Prisma.Decimal(12_600),
        incomeOther: new Prisma.Decimal(0),
        deductSso: new Prisma.Decimal(630),
        deductAdvance: new Prisma.Decimal(2_000),
        deductAttendance: new Prisma.Decimal(0),
        deductLeave: new Prisma.Decimal(60),
        deductDebt: new Prisma.Decimal(0),
        deductOther: new Prisma.Decimal(0),
        netPay: new Prisma.Decimal(9_910),
      },
    });
    await prisma.cashAdvance.create({
      data: {
        employeeId: emp.id,
        amount: new Prisma.Decimal(2_000),
        status: 'Approved',
        deductedInPayrollId: payroll.id,
      },
    });
    const lt = await prisma.leaveType.create({
      data: { name: 'ลากิจ', overQuotaPolicy: 'DeductPay', annualQuota: 0 },
    });
    await prisma.leaveRequest.create({
      data: {
        employeeId: emp.id,
        leaveTypeId: lt.id,
        startDate: new Date('2026-06-09'),
        endDate: new Date('2026-06-09'),
        reason: 'x',
        status: 'Approved',
        chargedMinutes: 60,
        overQuotaMinutes: 60,
        deductAmount: new Prisma.Decimal(60),
        deductedInPayrollId: payroll.id,
      },
    });

    const doc = await getPayslipDocument(emp.id, MONTH);
    expect(doc).not.toBeNull();
    expect(doc!.income.total).toBe(12_600);
    expect(doc!.deduct.total).toBe(2_690);
    expect(doc!.net).toBe(9_910);
    const sso = doc!.deduct.lines.find((l) => l.key === 'sso');
    expect(sso?.detail).toEqual({ key: 'sso', vars: { pct: 5, cap: '15,000' } });
    const leave = doc!.deduct.lines.find((l) => l.key === 'leave');
    expect(leave?.detail?.vars.minutes).toBe(60);
    const adv = doc!.deduct.lines.find((l) => l.key === 'advance');
    expect(adv?.detail?.vars.count).toBe(1);
  });
});
