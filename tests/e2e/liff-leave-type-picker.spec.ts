import { expect, test } from '@playwright/test';
import { loginAsWorker } from './helpers/auth';
import { cleanupE2eRecords, createE2eWorker, type E2eWorker, prisma } from './helpers/db';

/**
 * The leave-type picker is chips, and shows no quota figure — customer request
 * 2026-09-01: "เปลี่ยน ประเภทการลา จาก dropdown เป็น ตัวเลือก และไม่ต้องแสดงโควต้า".
 *
 * This spec covers the PRESENTATION only. The enforcement built on the quota —
 * Block-policy refusing over-quota submission, DeductPay staying submittable —
 * is covered by liff-leave-block.spec.ts, which must keep passing unchanged;
 * that is the regression gate for this change, not this file.
 *
 * NOTE: liff-*.spec.ts is excluded from CI (playwright.config.ts) because those
 * specs authenticate against a real LINE channel, so this must be run locally.
 */
test.describe('LIFF leave-type picker', () => {
  let worker: E2eWorker;

  test.beforeEach(async ({ page }) => {
    worker = await createE2eWorker({});
    await loginAsWorker(page, { email: worker.email, password: worker.password });
  });

  test.afterAll(async () => {
    await cleanupE2eRecords();
  });

  test('renders selectable chips, not a dropdown, and shows no quota figure', async ({ page }) => {
    const suffix = worker.employeeId.slice(0, 6);
    const kitName = `e2e-ลากิจ-${suffix}`;
    const vacName = `e2e-พักร้อน-${suffix}`;
    await prisma.leaveType.create({
      data: {
        name: kitName,
        annualQuota: 7,
        overQuotaPolicy: 'DeductPay',
        allowFullDay: true,
        isPaid: true,
      },
    });
    await prisma.leaveType.create({
      data: {
        name: vacName,
        annualQuota: 6,
        overQuotaPolicy: 'Block',
        allowFullDay: true,
        isPaid: true,
      },
    });

    await page.goto('/liff/leave/new');

    // The old <select> is gone.
    await expect(page.locator('select#leaveTypeId')).toHaveCount(0);

    // fieldset+legend is the group; native radios sit inside it.
    const group = page.getByRole('group', { name: /ประเภทการลา|Leave type/ });
    await expect(group).toBeVisible();

    // The chip the user sees and clicks is the label; the radio inside it is
    // sr-only, so visibility is asserted on the label and state on the input.
    const kitChip = page.locator('label').filter({ hasText: kitName });
    const vacChip = page.locator('label').filter({ hasText: vacName });
    await expect(kitChip).toBeVisible();
    await expect(vacChip).toBeVisible();

    const kit = page.getByRole('radio', { name: kitName });
    const vac = page.getByRole('radio', { name: vacName });

    // Selecting a chip actually moves the selection.
    await vacChip.click();
    await expect(vac).toBeChecked();
    await expect(kit).not.toBeChecked();
    await kitChip.click();
    await expect(kit).toBeChecked();
    await expect(vac).not.toBeChecked();

    // No quota figure in the picker: the seeded quotas are 7 and 6, and neither
    // may appear as a standalone number among the chips.
    await expect(group).not.toHaveText(/\b[67]\b/);
    // …nor the old "โควต้า"/"คงเหลือปีนี้" copy anywhere on the form.
    await expect(page.getByText(/โควต้า/)).toHaveCount(0);
    await expect(page.getByText(/คงเหลือปีนี้/)).toHaveCount(0);
  });
});
