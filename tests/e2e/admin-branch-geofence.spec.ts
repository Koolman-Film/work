import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';
import { cleanupE2eRecords, e2eId } from './helpers/db';

/**
 * Geofence picker — editable lat/long fields with two-way map sync.
 *
 * Verifies the admin can set a branch's coordinates by TYPING (not only by
 * clicking the map), that the typed values persist across a save + reload,
 * and that an out-of-range coordinate is rejected by the server's validation.
 *
 * Branch column is Decimal(10,7); the picker formats with toFixed(6), so a
 * value like 13.736700 round-trips to exactly "13.736700".
 */

test.afterAll(async () => {
  await cleanupE2eRecords();
});

test.describe('Branch geofence lat/long fields', () => {
  test('admin can type coordinates and they persist', async ({ page }) => {
    await loginAsAdmin(page);

    const name = `e2e-Branch-Geo-${e2eId()}`;
    await page.goto('/admin/settings/branches/new');

    await page.getByLabel('ชื่อสาขา').fill(name);
    await page.getByLabel(/ละติจูด/).fill('13.736700');
    await page.getByLabel(/ลองติจูด/).fill('100.523200');
    await page.getByRole('button', { name: 'สร้างสาขา' }).click();

    // Back on the list; open the new row's edit page to confirm persistence.
    await page.waitForURL(/\/admin\/settings\/branches$/);
    await expect(page.getByText(name).first()).toBeVisible();

    const editLink = page
      .locator('tr')
      .filter({ hasText: name })
      .getByRole('link', { name: 'แก้ไข' });
    await editLink.click();
    await page.waitForURL(/\/admin\/settings\/branches\/[^/]+\/edit/);

    await expect(page.getByLabel(/ละติจูด/)).toHaveValue('13.736700');
    await expect(page.getByLabel(/ลองติจูด/)).toHaveValue('100.523200');
  });

  test('rejects an out-of-range latitude on submit', async ({ page }) => {
    await loginAsAdmin(page);

    const name = `e2e-Branch-GeoBad-${e2eId()}`;
    await page.goto('/admin/settings/branches/new');

    await page.getByLabel('ชื่อสาขา').fill(name);
    // Client marks it invalid but does NOT block submit (non-blocking
    // validation by design); the server's coordSchema must reject it.
    await page.getByLabel(/ละติจูด/).fill('999');
    await page.getByLabel(/ลองติจูด/).fill('100.5');
    await page.getByRole('button', { name: 'สร้างสาขา' }).click();

    // Server redirects back to the create form with a Thai validation error.
    // (Target the text, not getByRole('alert') — Next.js always renders an
    // empty role="alert" route announcer, which makes the role ambiguous.)
    await page.waitForURL(/\/admin\/settings\/branches\/new\?error=/);
    await expect(page.getByText('lat ไม่ถูกต้อง')).toBeVisible();
  });
});
