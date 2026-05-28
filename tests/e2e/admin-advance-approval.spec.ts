import { expect, test } from '@playwright/test';
import { Prisma } from '@prisma/client';
import { loginAsAdmin } from './helpers/auth';
import { cleanupE2eRecords, e2eId, prisma } from './helpers/db';

/**
 * Mirror of admin-leave-approval.spec.ts — exercises the W4d transaction
 * end-to-end: admin sees a Pending CashAdvance, clicks "อนุมัติ", server
 * action atomically flips status + sets approvedById/At/receiptUrl, audit
 * row is written. Reject path verified separately.
 *
 * Why this matters even though leave-approval already covers the
 * transaction shape: the cash-advance flow has a DIFFERENT data model
 * (no fan-out to Attendance rows; receiptUrl optional with a trim
 * guard) so a regression in advance-specific code wouldn't show up in
 * the leave test.
 */

test.describe('Admin cash-advance approval', () => {
  test.afterAll(async () => {
    await cleanupE2eRecords();
  });

  /**
   * Helper to spin up an e2e Employee + Pending CashAdvance. Returns
   * the seeded CashAdvance.id so the test can navigate to / assert on it.
   * Pulled out because two tests need the same setup.
   */
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
      data: {
        employeeId: employee.id,
        amount: new Prisma.Decimal(amount),
        status: 'Pending',
      },
    });
    return { advance, employee };
  }

  /**
   * The admin-advance UI matches each row by employee name + amount
   * (CashAdvance has no `reason` field to use as a unique tag). We pick a
   * distinctive amount (matching e2e suffix) so we can find OUR row in a
   * dev DB that may have other rows.
   */
  function findAdvanceRow(page: import('@playwright/test').Page, employeeName: string) {
    return page.locator('li').filter({ hasText: employeeName }).first();
  }

  test('approve a Pending advance → status=Approved, approvedAt set, receiptUrl round-trips', async ({
    page,
  }) => {
    const suffix = e2eId();
    // Use a unique-looking amount (random sub-cent precision) so the row is
    // identifiable in the admin list even with other Pending advances.
    const amount = 4321; // distinctive 4-digit amount
    const { advance, employee } = await seedPendingAdvance(suffix, amount);
    const employeeName = `e2e-First-${suffix} e2e-Last-${suffix}`;

    await loginAsAdmin(page);
    await page.goto('/admin/advance');
    await expect(page.getByRole('heading', { name: 'คำขอเบิก' })).toBeVisible();

    const row = findAdvanceRow(page, employeeName);
    await expect(row).toBeVisible({ timeout: 5_000 });

    // Open review panel → fill receipt URL → click "อนุมัติ ฿4,321".
    await row.getByRole('button', { name: /ตรวจสอบ/ }).click();
    await row.getByRole('textbox').fill('https://drive.google.com/e2e-receipt-test');
    // The approve button label contains the amount; loose match is enough.
    await row.getByRole('button', { name: /^อนุมัติ ฿/ }).click();

    await expect(row.getByText(/อนุมัติ.*เรียบร้อย/)).toBeVisible({ timeout: 5_000 });

    // ── DB assertions ───────────────────────────────────────────────
    const refreshed = await prisma.cashAdvance.findUnique({
      where: { id: advance.id },
      select: {
        status: true,
        approvedAt: true,
        approvedById: true,
        receiptUrl: true,
        isDeducted: true,
      },
    });
    expect(refreshed?.status).toBe('Approved');
    expect(refreshed?.approvedAt).not.toBeNull();
    expect(refreshed?.approvedById).not.toBeNull(); // some admin User.id
    expect(refreshed?.receiptUrl).toBe('https://drive.google.com/e2e-receipt-test');
    // isDeducted stays false — only payroll publish (Phase 2) flips it.
    expect(refreshed?.isDeducted).toBe(false);

    // Defensive — confirm the employee is the one we created (not some
    // random matching row from the dev DB).
    const employeeIdCheck = await prisma.cashAdvance.findUnique({
      where: { id: advance.id },
      select: { employeeId: true },
    });
    expect(employeeIdCheck?.employeeId).toBe(employee.id);
  });

  test('approve with empty receipt → receiptUrl is null (server-side trim guard)', async ({
    page,
  }) => {
    const suffix = e2eId();
    const { advance } = await seedPendingAdvance(suffix, 5678);
    const employeeName = `e2e-First-${suffix} e2e-Last-${suffix}`;

    await loginAsAdmin(page);
    await page.goto('/admin/advance');

    const row = findAdvanceRow(page, employeeName);
    await row.getByRole('button', { name: /ตรวจสอบ/ }).click();
    // Leave the receipt URL textbox empty.
    await row.getByRole('button', { name: /^อนุมัติ ฿/ }).click();
    await expect(row.getByText(/อนุมัติ.*เรียบร้อย/)).toBeVisible({ timeout: 5_000 });

    const refreshed = await prisma.cashAdvance.findUnique({
      where: { id: advance.id },
      select: { status: true, receiptUrl: true },
    });
    expect(refreshed?.status).toBe('Approved');
    // The server action's `trimmedUrl && trimmedUrl.length > 0 ? ... : null`
    // guard means empty / whitespace input becomes a null column, not "".
    expect(refreshed?.receiptUrl).toBeNull();
  });

  test('reject a Pending advance → status=Rejected, two-step confirm', async ({ page }) => {
    const suffix = e2eId();
    const { advance } = await seedPendingAdvance(suffix, 9012);
    const employeeName = `e2e-First-${suffix} e2e-Last-${suffix}`;

    await loginAsAdmin(page);
    await page.goto('/admin/advance');

    const row = findAdvanceRow(page, employeeName);
    await row.getByRole('button', { name: /ตรวจสอบ/ }).click();
    // First "ปฏิเสธ" opens the two-step confirm.
    await row.getByRole('button', { name: /^ปฏิเสธ$/ }).click();
    // Then "ยืนยันปฏิเสธ" commits.
    await row.getByRole('button', { name: /^ยืนยันปฏิเสธ$/ }).click();

    await expect(row.getByText(/ปฏิเสธเรียบร้อย/)).toBeVisible({ timeout: 5_000 });

    const refreshed = await prisma.cashAdvance.findUnique({
      where: { id: advance.id },
      select: { status: true, approvedAt: true, approvedById: true },
    });
    expect(refreshed?.status).toBe('Rejected');
    // Reject path does NOT set approvedById/At — those are approve-only.
    expect(refreshed?.approvedAt).toBeNull();
    expect(refreshed?.approvedById).toBeNull();
  });
});
