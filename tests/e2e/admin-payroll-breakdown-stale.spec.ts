import { expect, test } from '@playwright/test';
import { Prisma } from '@prisma/client';
import { loginAsAdmin } from './helpers/auth';
import { cleanupE2eRecords, e2eId, prisma } from './helpers/db';

/**
 * Payroll: (1) the deduction column shows an inline breakdown so the total
 * reconciles, and (2) a Draft whose inputs no longer match is flagged stale.
 *
 * A Draft row with fabricated deductions (no backing advance/attendance) is BOTH:
 *   - a breakdown demo (เบิก 9,200 · ขาด/สาย 500), and
 *   - stale (recompute yields 0/0 ≠ stored) → the warning fires.
 */
test.describe('Payroll deduction breakdown + stale-draft warning', () => {
  const suffix = e2eId();
  const month = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 7);

  test.afterAll(async () => {
    // Payroll FK is Restrict, so drop e2e payroll rows before the employees.
    const emps = await prisma.employee.findMany({
      where: { lastName: { startsWith: 'e2e-' } },
      select: { id: true },
    });
    await prisma.payroll.deleteMany({ where: { employeeId: { in: emps.map((e) => e.id) } } });
    await cleanupE2eRecords();
  });

  test('shows the breakdown and flags the draft as needing recalculation', async ({ page }) => {
    const branch = await prisma.branch.create({ data: { name: `e2e-Branch-${suffix}` } });
    const user = await prisma.user.create({ data: {} });
    const emp = await prisma.employee.create({
      data: {
        userId: user.id,
        firstName: `e2e-Pay`,
        lastName: `e2e-${suffix}`,
        branchId: branch.id,
        salaryType: 'Monthly',
        baseSalary: new Prisma.Decimal(20_000),
        status: 'Active',
        canCheckIn: true,
        hiredAt: new Date('2026-01-01'),
      },
    });

    // A Draft with deductions that have NO backing source rows → recompute
    // would yield 0, so the page must flag it stale.
    await prisma.payroll.create({
      data: {
        employeeId: emp.id,
        month,
        status: 'Draft',
        incomeBase: new Prisma.Decimal(20_000),
        deductAdvance: new Prisma.Decimal(9_200),
        deductAttendance: new Prisma.Decimal(500),
        netPay: new Prisma.Decimal(10_300),
      },
    });

    await loginAsAdmin(page);
    await page.goto(`/admin/payroll?m=${month}`);
    await page.waitForLoadState('networkidle');

    const body = page.locator('body');
    // Deduction breakdown is visible and reconciles the total.
    await expect(body).toContainText('เบิก 9,200');
    await expect(body).toContainText('ขาด/สาย 500');
    // Stale-draft warning + per-row badge.
    await expect(body).toContainText('ข้อมูลเปลี่ยนแปลงหลังคำนวณ');
    await expect(body).toContainText('ต้องคำนวณใหม่');
  });
});
