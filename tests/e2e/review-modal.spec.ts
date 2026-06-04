import { expect, test } from '@playwright/test';
import { Prisma } from '@prisma/client';
import { loginAsAdmin } from './helpers/auth';
import { cleanupE2eRecords, e2eId, prisma } from './helpers/db';

/**
 * Contract test for the shared <ReviewModal>, exercised through the real
 * /admin/advance flow (money is the canonical sensitive action). Verifies:
 *   1. the modal SHOWS the ฿amount being reviewed,
 *   2. the money-confirm step can be backed out of, and closing aborts with
 *      no mutation,
 *   3. CONFIRM commits the underlying approve,
 *   4. the in-modal VOID step soft-deletes the request.
 *
 * Complements admin-advance-approval (which asserts the W4d transaction
 * shape). If ReviewModal regresses — confirm fires on cancel, the amount
 * stops rendering, or void breaks — this catches it.
 */

test.describe('ReviewModal (via /admin/advance)', () => {
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

  function openRow(page: import('@playwright/test').Page, suffix: string) {
    return page.getByRole('button', { name: new RegExp(`ตรวจสอบคำขอเบิกของ.*${suffix}`) });
  }

  test('shows the amount; money-confirm back + close abort (no mutation)', async ({ page }) => {
    const suffix = e2eId();
    const { advance } = await seedPendingAdvance(suffix, 7777);

    await loginAsAdmin(page);
    await page.goto('/admin/advance');

    const row = openRow(page, suffix);
    await expect(row).toBeVisible({ timeout: 5_000 });
    await row.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // The modal body shows the ฿amount being reviewed.
    await expect(dialog.getByText(/฿7,777/).first()).toBeVisible();

    // Step into the money-confirm, then back out.
    await dialog.getByRole('button', { name: /^อนุมัติ ฿/ }).click();
    await expect(dialog.getByText(/ยืนยันการอนุมัติ/)).toBeVisible();
    await dialog.getByRole('button', { name: /^กลับ$/ }).click();

    // Close the modal entirely via the ✕.
    await dialog.getByRole('button', { name: 'ปิด' }).click();
    await expect(dialog).toBeHidden();

    const after = await prisma.cashAdvance.findUnique({
      where: { id: advance.id },
      select: { status: true, approvedAt: true },
    });
    expect(after?.status).toBe('Pending');
    expect(after?.approvedAt).toBeNull();
  });

  test('CONFIRM commits the approve', async ({ page }) => {
    const suffix = e2eId();
    const { advance } = await seedPendingAdvance(suffix, 8888);

    await loginAsAdmin(page);
    await page.goto('/admin/advance');

    const row = openRow(page, suffix);
    await expect(row).toBeVisible({ timeout: 5_000 });
    await row.click();

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /^อนุมัติ ฿/ }).click();
    await dialog.getByRole('button', { name: /^ยืนยันอนุมัติ/ }).click();
    await expect(dialog).toBeHidden({ timeout: 5_000 });

    const after = await prisma.cashAdvance.findUnique({
      where: { id: advance.id },
      select: { status: true, approvedById: true },
    });
    expect(after?.status).toBe('Approved');
    expect(after?.approvedById).not.toBeNull();
  });

  test('void from the modal soft-deletes the request', async ({ page }) => {
    const suffix = e2eId();
    const { advance } = await seedPendingAdvance(suffix, 6543);

    await loginAsAdmin(page);
    await page.goto('/admin/advance');

    const row = openRow(page, suffix);
    await expect(row).toBeVisible({ timeout: 5_000 });
    await row.click();

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /^ลบรายการ$/ }).click();
    await dialog.getByRole('textbox').fill('e2e — void test');
    await dialog.getByRole('button', { name: /^ยืนยันลบ$/ }).click();
    await expect(dialog).toBeHidden({ timeout: 5_000 });

    const after = await prisma.cashAdvance.findUnique({
      where: { id: advance.id },
      select: { deletedAt: true, deleteReason: true },
    });
    expect(after?.deletedAt).not.toBeNull();
    expect(after?.deleteReason).toBe('e2e — void test');
  });
});
