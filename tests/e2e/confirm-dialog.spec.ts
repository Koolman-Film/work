import { expect, test } from '@playwright/test';
import { Prisma } from '@prisma/client';
import { loginAsAdmin } from './helpers/auth';
import { cleanupE2eRecords, e2eId, prisma } from './helpers/db';

/**
 * Contract test for the shared <ConfirmDialog> primitive, exercised
 * through the real /admin/advance approve flow (money is the canonical
 * sensitive action). Verifies the three guarantees every sensitive action
 * relies on:
 *   1. the dialog SHOWS what's being confirmed (the ฿amount),
 *   2. CANCEL aborts with no mutation,
 *   3. CONFIRM commits the underlying server action.
 *
 * This is component-level coverage that complements admin-advance-approval
 * (which asserts the W4d transaction shape). If ConfirmDialog regresses —
 * e.g. confirm fires on cancel, or the dialog stops rendering its
 * description — this catches it regardless of which page hosts it.
 */

test.describe('ConfirmDialog (via /admin/advance approve)', () => {
  test.afterAll(async () => {
    await cleanupE2eRecords();
  });

  async function seedPendingAdvance(suffix: string, amount: number) {
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
    const advance = await prisma.cashAdvance.create({
      data: { employeeId: employee.id, amount: new Prisma.Decimal(amount), status: 'Pending' },
    });
    return { advance };
  }

  function findRow(page: import('@playwright/test').Page, employeeName: string) {
    return page.locator('li').filter({ hasText: employeeName }).first();
  }

  test('shows the amount and CANCEL aborts (no mutation)', async ({ page }) => {
    const suffix = e2eId();
    const { advance } = await seedPendingAdvance(suffix, 7777);
    const employeeName = `e2e-First-${suffix} e2e-Last-${suffix}`;

    await loginAsAdmin(page);
    await page.goto('/admin/advance');

    const row = findRow(page, employeeName);
    await row.getByRole('button', { name: /ตรวจสอบ/ }).click();
    await row.getByRole('button', { name: /^อนุมัติ ฿/ }).click();

    // The dialog is open and shows the ฿amount being confirmed.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/฿7,777/)).toBeVisible();

    // Cancel → dialog closes, nothing mutates.
    await dialog.getByRole('button', { name: /^ยกเลิก$/ }).click();
    await expect(dialog).toBeHidden();

    const afterCancel = await prisma.cashAdvance.findUnique({
      where: { id: advance.id },
      select: { status: true, approvedAt: true },
    });
    expect(afterCancel?.status).toBe('Pending');
    expect(afterCancel?.approvedAt).toBeNull();
  });

  test('CONFIRM commits the approve', async ({ page }) => {
    const suffix = e2eId();
    const { advance } = await seedPendingAdvance(suffix, 8888);
    const employeeName = `e2e-First-${suffix} e2e-Last-${suffix}`;

    await loginAsAdmin(page);
    await page.goto('/admin/advance');

    const row = findRow(page, employeeName);
    await row.getByRole('button', { name: /ตรวจสอบ/ }).click();
    await row.getByRole('button', { name: /^อนุมัติ ฿/ }).click();
    await row.getByRole('button', { name: /^ยืนยันอนุมัติ$/ }).click();

    await expect(row.getByText(/อนุมัติ.*เรียบร้อย/)).toBeVisible({ timeout: 5_000 });

    const after = await prisma.cashAdvance.findUnique({
      where: { id: advance.id },
      select: { status: true, approvedById: true },
    });
    expect(after?.status).toBe('Approved');
    expect(after?.approvedById).not.toBeNull();
  });
});
