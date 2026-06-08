import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';
import { cleanupE2eRecords } from './helpers/db';

/**
 * Geofence address search (Nominatim) — wiring test.
 *
 * /api/geocode is STUBBED (no live Nominatim) so the test is deterministic and
 * never depends on an external service. Asserts: search → dropdown → pick →
 * the ละติจูด/ลองติจูด fields fill (proving onSelect → syncFromMap), and the
 * empty-results state.
 */

test.afterAll(async () => {
  await cleanupE2eRecords();
});

test.describe('Branch geofence address search', () => {
  test('search → pick a match → lat/long fields fill', async ({ page }) => {
    await page.route('**/api/geocode*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { displayName: 'CentralWorld, Bangkok', lat: 13.7466, lng: 100.5396 },
          { displayName: 'Central Rama 9, Bangkok', lat: 13.758, lng: 100.565 },
        ]),
      }),
    );

    await loginAsAdmin(page);
    await page.goto('/admin/settings/branches/new');

    const search = page.getByLabel('ค้นหาสถานที่เพื่อปักหมุด');
    await search.fill('central');
    await search.press('Enter');

    // Dropdown shows the stubbed matches; pick the first.
    await page.getByRole('button', { name: /CentralWorld/ }).click();

    // onSelect → syncFromMap filled the fields (formatted to 6 dp).
    await expect(page.getByLabel(/ละติจูด/)).toHaveValue('13.746600');
    await expect(page.getByLabel(/ลองติจูด/)).toHaveValue('100.539600');
  });

  test('no matches shows an empty state', async ({ page }) => {
    await page.route('**/api/geocode*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );

    await loginAsAdmin(page);
    await page.goto('/admin/settings/branches/new');

    const search = page.getByLabel('ค้นหาสถานที่เพื่อปักหมุด');
    await search.fill('zzz nowhere place');
    await search.press('Enter');

    await expect(page.getByText('ไม่พบสถานที่')).toBeVisible();
  });
});
