import { expect, test } from '@playwright/test';
import { loginAsWorker } from './helpers/auth';
import { cleanupE2eRecords, createE2eWorker, type E2eWorker, prisma } from './helpers/db';

/**
 * Leave over-entitlement enforcement at SUBMISSION (PDF requirement A1):
 *   - Block policy (e.g. พักร้อน): worker must NOT be able to submit over quota
 *     — the submit button is disabled and a block message shown. Server also
 *     rejects (defence-in-depth), but the UX is the user-facing guarantee.
 *   - DeductPay policy (ลากิจ/ลาป่วย/…): over-quota stays submittable (it just
 *     becomes a salary deduction), so we assert it is NOT over-blocked.
 *
 * Both types are seeded with annualQuota=0 → remaining 0 → any full day exceeds.
 */

/** Next Monday (Bangkok) as YYYY-MM-DD — a guaranteed weekday so a FullDay
 *  leave charges >0 working-day minutes (Sundays charge 0 and wouldn't exceed). */
function nextMondayYmd(): string {
  const ymd = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  const d = new Date(`${ymd}T00:00:00.000Z`);
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  d.setUTCDate(d.getUTCDate() + (dow === 1 ? 0 : (1 - dow + 7) % 7));
  return d.toISOString().slice(0, 10);
}

test.describe('LIFF leave over-quota enforcement', () => {
  let worker: E2eWorker;
  const monday = nextMondayYmd();

  test.beforeEach(async ({ page }) => {
    worker = await createE2eWorker({});
    await loginAsWorker(page, { email: worker.email, password: worker.password });
  });

  test.afterAll(async () => {
    await cleanupE2eRecords();
  });

  test('Block-policy type cannot be submitted over quota', async ({ page }) => {
    const lt = await prisma.leaveType.create({
      data: {
        name: `e2e-พักร้อน-${worker.employeeId.slice(0, 6)}`,
        annualQuota: 0, // 0 remaining → any leave exceeds
        overQuotaPolicy: 'Block',
        allowFullDay: true,
        isPaid: true,
      },
    });

    await page.goto('/liff/leave/new');
    await page.locator('#leaveTypeId').selectOption(lt.id);
    await page.fill('#startDate', monday);
    await page.fill('#endDate', monday);
    await page.fill('#reason', 'e2e-test-vacation');

    // Block message shown + submit hard-disabled.
    await expect(page.getByText('ไม่สามารถส่งคำขอนี้ได้')).toBeVisible();
    await expect(page.getByRole('button', { name: 'ส่งคำขอ' })).toBeDisabled();
  });

  test('DeductPay-policy type stays submittable over quota (becomes a deduction)', async ({
    page,
  }) => {
    const lt = await prisma.leaveType.create({
      data: {
        name: `e2e-ลากิจ-${worker.employeeId.slice(0, 6)}`,
        annualQuota: 0,
        overQuotaPolicy: 'DeductPay',
        allowFullDay: true,
        isPaid: true,
      },
    });

    await page.goto('/liff/leave/new');
    await page.locator('#leaveTypeId').selectOption(lt.id);
    await page.fill('#startDate', monday);
    await page.fill('#endDate', monday);
    await page.fill('#reason', 'e2e-test-personal');

    // Over-quota deduction warning shown, but submit remains ENABLED.
    await expect(page.getByText('จะถูกหักเงิน')).toBeVisible();
    await expect(page.getByRole('button', { name: 'ส่งคำขอ' })).toBeEnabled();
  });
});
