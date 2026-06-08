import { expect, test } from '@playwright/test';
import { Prisma } from '@prisma/client';
import { loginAsAdmin } from './helpers/auth';
import { cleanupE2eRecords, e2eId, prisma } from './helpers/db';

/**
 * /admin/calendar day-detail panel is clickable: a Pending advance on today's
 * cell opens the ตรวจสอบคำขอเบิก review modal, and approving from there flips
 * status + refreshes the calendar. Mirrors admin-advance-approval but exercises
 * the calendar entry point + the shared extracted modal.
 */
test.describe('Admin calendar click-to-review', () => {
  test.afterAll(async () => {
    await cleanupE2eRecords();
  });

  async function seedEmployee(suffix: string) {
    const branch = await prisma.branch.create({ data: { name: `e2e-Branch-${suffix}` } });
    const user = await prisma.user.create({ data: {} });
    const employee = await prisma.employee.create({
      data: {
        userId: user.id,
        firstName: `e2e-First-${suffix}`,
        lastName: `e2e-Last-${suffix}`,
        branchId: branch.id,
        assignedBranchIds: [branch.id],
        salaryType: 'Monthly',
        baseSalary: new Prisma.Decimal(20_000),
        status: 'Active',
        canCheckIn: true,
        hiredAt: new Date('2026-01-01'),
      },
    });
    return employee;
  }

  test('approve a Pending advance from the calendar day-detail panel', async ({ page }) => {
    const suffix = e2eId();
    const amount = 3210;
    const employee = await seedEmployee(suffix);
    const advance = await prisma.cashAdvance.create({
      data: {
        employeeId: employee.id,
        amount: new Prisma.Decimal(amount),
        status: 'Pending',
        // requestedAt defaults to now() → lands on today's cell (preselected).
      },
    });
    const employeeName = `e2e-First-${suffix} e2e-Last-${suffix}`;

    await loginAsAdmin(page);
    await page.goto('/admin/calendar');
    await expect(page.getByRole('heading', { name: 'ปฏิทินงาน' }).first()).toBeVisible();

    // The right-panel advance row is a button labelled with the employee name.
    const row = page.getByRole('button', { name: new RegExp(employeeName) });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('ตรวจสอบคำขอเบิก')).toBeVisible({ timeout: 10_000 });
    await dialog.getByRole('button', { name: /^อนุมัติ ฿/ }).click();
    await dialog.getByRole('button', { name: /^ยืนยันอนุมัติ/ }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    const refreshed = await prisma.cashAdvance.findUnique({
      where: { id: advance.id },
      select: { status: true, approvedAt: true, approvedById: true, employeeId: true },
    });
    expect(refreshed?.status).toBe('Approved');
    expect(refreshed?.approvedAt).not.toBeNull();
    expect(refreshed?.approvedById).not.toBeNull();
    expect(refreshed?.employeeId).toBe(employee.id);
  });
});
