import { expect, test } from '@playwright/test';
import { loginAsWorker } from './helpers/auth';
import { cleanupE2eRecords, createE2eWorker, type E2eWorker, prisma } from './helpers/db';

/**
 * Advance NET-cap enforcement at submission (PDF requirement C7):
 *   - The cap is gross − SSO − active recurring deductions ("เงินเดือนสุทธิ"),
 *     enforced when the worker submits (not just at admin approval).
 *
 * The worker has baseSalary 20,000 (no SSO). We add a 5,000/mo recurring
 * deduction → NET cap = 15,000. Requesting 18,000 is UNDER gross but OVER net,
 * so it must be blocked — proving the cap is net, not gross.
 */

test.describe('LIFF advance NET-cap enforcement', () => {
  let worker: E2eWorker;

  test.beforeEach(async ({ page }) => {
    worker = await createE2eWorker({});
    await prisma.recurringDeduction.create({
      data: {
        employeeId: worker.employeeId,
        reason: 'e2e-loan',
        monthlyAmount: 5_000, // net cap = 20,000 − 5,000 = 15,000
        monthsRemaining: 5,
      },
    });
    await loginAsWorker(page, { email: worker.email, password: worker.password });
  });

  test.afterAll(async () => {
    await cleanupE2eRecords();
  });

  test('blocks an amount under gross but over NET (proves net basis)', async ({ page }) => {
    await page.goto('/liff/advance/new');
    await page.fill('#amount', '18000'); // < 20,000 gross, > 15,000 net

    await expect(page.getByText('ไม่สามารถส่งคำขอได้')).toBeVisible();
    await expect(page.getByRole('button', { name: 'ส่งคำขอ' })).toBeDisabled();
  });

  test('allows an amount within the NET cap', async ({ page }) => {
    await page.goto('/liff/advance/new');
    await page.fill('#amount', '10000'); // < 15,000 net

    await expect(page.getByRole('button', { name: 'ส่งคำขอ' })).toBeEnabled();
  });
});
