import { Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { loadEmployeePayslipHistory, loadMonthPayslipTargets } from '@/lib/payslip/history';

// Wipe transactional tables (shared dedicated test DB) — widened beyond
// Payroll/Employee/User/Branch because other integration suites (reports,
// payroll-pipeline, payslip-document) leave FK-referencing rows (Employee has
// onDelete: Restrict from Attendance/CashAdvance/LeaveRequest/etc.) that would
// otherwise block `employee.deleteMany`.
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
}

async function makeEmp(branchId: string, firstName: string) {
  const user = await prisma.user.create({ data: {} });
  return prisma.employee.create({
    data: {
      userId: user.id,
      firstName,
      lastName: 'ทดสอบ',
      branchId,
      salaryType: 'Monthly',
      baseSalary: new Prisma.Decimal(20000),
      status: 'Active',
      hiredAt: new Date('2026-01-01'),
    },
  });
}
async function makePayroll(
  employeeId: string,
  month: string,
  status: 'Draft' | 'Published' | 'Locked',
  net = 19000,
) {
  // Balanced so the row satisfies the payroll_net_reconciles CHECK (0045):
  // production cannot hold a Payroll row that does not add up, and a fixture
  // should not invent one. Only month/status/net matter to these assertions.
  const incomeBase = 20000;
  return prisma.payroll.create({
    data: {
      employeeId,
      month,
      incomeBase: new Prisma.Decimal(incomeBase),
      netPay: new Prisma.Decimal(net),
      deductOther: new Prisma.Decimal(incomeBase - net),
      status,
    },
  });
}

beforeEach(reset);
afterAll(async () => {
  await prisma.$disconnect();
});

describe('loadEmployeePayslipHistory', () => {
  it('returns Published/Locked months newest-first, excluding Draft', async () => {
    const b = await prisma.branch.create({ data: { name: 'HQ' } });
    const e = await makeEmp(b.id, 'ก');
    await makePayroll(e.id, '2026-04', 'Locked', 18000);
    await makePayroll(e.id, '2026-06', 'Published', 19000);
    await makePayroll(e.id, '2026-05', 'Draft', 0); // excluded
    const hist = await loadEmployeePayslipHistory(e.id);
    expect(hist.map((h) => h.month)).toEqual(['2026-06', '2026-04']);
    expect(hist[0]).toEqual({ month: '2026-06', netPay: 19000 });
  });
});

describe('loadMonthPayslipTargets', () => {
  it('returns frozen-slip employees for a month, branch-scoped, excluding Draft', async () => {
    const hq = await prisma.branch.create({ data: { name: 'HQ' } });
    const other = await prisma.branch.create({ data: { name: 'Other' } });
    const e1 = await makeEmp(hq.id, 'ก');
    const e2 = await makeEmp(hq.id, 'ข');
    const e3 = await makeEmp(other.id, 'ค');
    await makePayroll(e1.id, '2026-06', 'Published');
    await makePayroll(e2.id, '2026-06', 'Draft'); // excluded (not frozen)
    await makePayroll(e3.id, '2026-06', 'Published'); // other branch
    // 'all' → both HQ + other frozen
    expect(
      (await loadMonthPayslipTargets('2026-06', 'all')).map((t) => t.employeeId).sort(),
    ).toEqual([e1.id, e3.id].sort());
    // scoped to HQ → only e1
    expect((await loadMonthPayslipTargets('2026-06', [hq.id])).map((t) => t.employeeId)).toEqual([
      e1.id,
    ]);
  });
});
