import { Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { loadReconciliation } from '@/lib/payroll/reconcile-data';

async function reset() {
  await prisma.payrollAdjustment.deleteMany({});
  await prisma.payroll.deleteMany({});
  await prisma.employee.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.branch.deleteMany({});
}
beforeEach(reset);
afterAll(async () => {
  await prisma.$disconnect();
});

async function emp(branchId: string, firstName: string, salary = 20000) {
  const user = await prisma.user.create({ data: {} });
  return prisma.employee.create({
    data: {
      userId: user.id,
      firstName,
      lastName: 'ทดสอบ',
      branchId,
      salaryType: 'Monthly',
      baseSalary: new Prisma.Decimal(salary),
      status: 'Active',
      hiredAt: new Date('2026-01-01'),
    },
  });
}
async function pay(
  employeeId: string,
  month: string,
  status: 'Draft' | 'Published' | 'Locked',
  o: { incomeBase?: number; netPay?: number; deductAttendance?: number } = {},
) {
  const incomeBase = o.incomeBase ?? 20000;
  const netPay = o.netPay ?? 19000;
  const deductAttendance = o.deductAttendance ?? 0;
  // A Payroll row must satisfy the payroll_net_reconciles CHECK (0045): one that
  // does not add up cannot exist in production, so a fixture must not invent one
  // either — a test asserting behaviour on an impossible row proves little.
  // Whatever the caller's incomeBase/netPay imply beyond the stated deductions
  // is carried by deductOther, which no assertion here inspects.
  const deductOther = incomeBase - deductAttendance - netPay;
  return prisma.payroll.create({
    data: {
      employeeId,
      month,
      status,
      incomeBase: new Prisma.Decimal(incomeBase),
      netPay: new Prisma.Decimal(netPay),
      deductAttendance: new Prisma.Decimal(deductAttendance),
      deductOther: new Prisma.Decimal(deductOther),
    },
  });
}

describe('loadReconciliation', () => {
  it('uses the latest FROZEN prior month as baseline (ignores a newer Draft, skips gaps)', async () => {
    const b = await prisma.branch.create({ data: { name: 'HQ' } });
    const e = await emp(b.id, 'ก');
    await pay(e.id, '2026-04', 'Locked', { netPay: 19000 });
    // no May row at all (gap) — April is the baseline for June
    await pay(e.id, '2026-06', 'Draft', { netPay: 12000 }); // -37% vs April
    const view = await loadReconciliation('2026-06');
    const rowE = view.rows.find((r) => r.employeeId === e.id);
    expect(rowE?.baseline?.month).toBe('2026-04');
    expect(rowE?.flags.some((f) => f.kind === 'net-swing')).toBe(true);
  });

  it('picks the NEWEST frozen month when several frozen prior months exist', async () => {
    const b = await prisma.branch.create({ data: { name: 'HQ' } });
    const e = await emp(b.id, 'ฉ');
    await pay(e.id, '2026-03', 'Locked', { netPay: 15000 });
    await pay(e.id, '2026-04', 'Published', { netPay: 18000 });
    await pay(e.id, '2026-05', 'Locked', { netPay: 19000 }); // newest frozen → baseline
    await pay(e.id, '2026-06', 'Draft', { netPay: 19000 });
    const view = await loadReconciliation('2026-06');
    const rowE = view.rows.find((r) => r.employeeId === e.id);
    expect(rowE?.baseline?.month).toBe('2026-05');
    expect(rowE?.baseline?.netPay).toBe(19000);
  });

  it('flags missing-from-run for an active employee with a baseline but no current row', async () => {
    const b = await prisma.branch.create({ data: { name: 'HQ' } });
    const e = await emp(b.id, 'ข');
    await pay(e.id, '2026-05', 'Published', { netPay: 19000 });
    // no 2026-06 row
    const view = await loadReconciliation('2026-06');
    const rowE = view.rows.find((r) => r.employeeId === e.id);
    expect(rowE?.current).toBeNull();
    expect(rowE?.flags).toContainEqual({ kind: 'missing-from-run' });
  });

  it('excludes archived employees from the roster and computes branch subtotals + totals', async () => {
    const hq = await prisma.branch.create({ data: { name: 'HQ' } });
    const cnx = await prisma.branch.create({ data: { name: 'CNX' } });
    const a = await emp(hq.id, 'ค');
    const c = await emp(cnx.id, 'ง');
    const archived = await emp(hq.id, 'จ');
    await prisma.employee.update({ where: { id: archived.id }, data: { archivedAt: new Date() } });
    await pay(a.id, '2026-06', 'Draft', { incomeBase: 20000, netPay: 19000 });
    await pay(c.id, '2026-06', 'Draft', { incomeBase: 30000, netPay: 28000 });
    const view = await loadReconciliation('2026-06');
    expect(view.rows.some((r) => r.employeeId === archived.id)).toBe(false);
    expect(view.totals.headcount).toBe(2);
    expect(view.totals.net).toBe(47000);
    expect(view.byBranch.find((x) => x.branchName === 'CNX')?.net).toBe(28000);
  });
});
