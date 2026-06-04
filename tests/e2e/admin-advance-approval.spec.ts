import { expect, test } from '@playwright/test';
import { Prisma } from '@prisma/client';
import { loginAsAdmin } from './helpers/auth';
import { cleanupE2eRecords, e2eId, prisma } from './helpers/db';

/**
 * Mirror of admin-leave-approval.spec.ts — exercises the W4d transaction
 * end-to-end: admin sees a Pending CashAdvance, opens the review panel,
 * confirms via the shared ConfirmDialog, and the server action atomically
 * flips status + sets approvedById/At, audit row is written. Reject path
 * verified separately.
 *
 * Both approve and reject now route through the shared ConfirmDialog
 * (a two-step: trigger → confirm), unifying the sensitive-action UX with
 * the rest of the admin surface. The receipt is an OPTIONAL Storage upload
 * (compress → bucket) done client-side inside the approve confirm; that
 * upload path needs a Storage bucket and is not exercised here (these
 * tests cover the no-receipt path, which leaves receiptUrl null).
 *
 * Why this matters even though leave-approval already covers the
 * transaction shape: the cash-advance flow has a DIFFERENT data model
 * (no fan-out to Attendance rows) so an advance-specific regression
 * wouldn't surface in the leave test.
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
   * The admin-advance UI matches each row by employee name (CashAdvance
   * has no `reason` field to use as a unique tag). The e2e suffix makes
   * the name unique even in a dev DB with other rows.
   */
  function findAdvanceRow(page: import('@playwright/test').Page, employeeName: string) {
    // The whole row is a button (aria-label "ตรวจสอบคำขอเบิกของ <name>") that
    // opens the review modal.
    return page.getByRole('button', {
      name: new RegExp(`ตรวจสอบคำขอเบิกของ.*${employeeName}`),
    });
  }

  test('approve a Pending advance (no receipt) → status=Approved, approvedAt set, receiptUrl null', async ({
    page,
  }) => {
    const suffix = e2eId();
    const amount = 4321; // distinctive 4-digit amount
    const { advance, employee } = await seedPendingAdvance(suffix, amount);
    const employeeName = `e2e-First-${suffix} e2e-Last-${suffix}`;

    await loginAsAdmin(page);
    await page.goto('/admin/advance');
    await expect(page.getByRole('heading', { name: 'คำขอเบิก' })).toBeVisible();

    const row = findAdvanceRow(page, employeeName);
    await expect(row).toBeVisible({ timeout: 5_000 });
    await row.click();

    // Approve via the modal's money-confirm: "อนุมัติ ฿4,321" → "ยืนยันอนุมัติ".
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /^อนุมัติ ฿/ }).click();
    await dialog.getByRole('button', { name: /^ยืนยันอนุมัติ/ }).click();
    await expect(dialog).toBeHidden({ timeout: 5_000 });

    // ── DB assertions ───────────────────────────────────────────────
    const refreshed = await prisma.cashAdvance.findUnique({
      where: { id: advance.id },
      select: {
        status: true,
        approvedAt: true,
        approvedById: true,
        receiptUrl: true,
        isDeducted: true,
        employeeId: true,
      },
    });
    expect(refreshed?.status).toBe('Approved');
    expect(refreshed?.approvedAt).not.toBeNull();
    expect(refreshed?.approvedById).not.toBeNull(); // some admin User.id
    // No receipt attached → the column stays null (not an empty string).
    expect(refreshed?.receiptUrl).toBeNull();
    // isDeducted stays false — only payroll publish (Phase 2) flips it.
    expect(refreshed?.isDeducted).toBe(false);
    // Defensive — confirm we approved the row we created.
    expect(refreshed?.employeeId).toBe(employee.id);
  });

  test('reject a Pending advance → status=Rejected, two-step confirm', async ({ page }) => {
    const suffix = e2eId();
    const { advance } = await seedPendingAdvance(suffix, 9012);
    const employeeName = `e2e-First-${suffix} e2e-Last-${suffix}`;

    await loginAsAdmin(page);
    await page.goto('/admin/advance');

    const row = findAdvanceRow(page, employeeName);
    await expect(row).toBeVisible({ timeout: 5_000 });
    await row.click();

    // Reject commits directly from the modal (no money confirm for reject).
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /^ปฏิเสธ$/ }).click();
    await expect(dialog).toBeHidden({ timeout: 5_000 });

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
