import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

/**
 * Mobile sidebar drawer (Sapphire AppShell). Runs only in the `mobile`
 * Playwright project (phone viewport) via the @mobile tag.
 *
 * Asserts the drawer mechanics by the aside's rendered x-position: it sits
 * off-screen (negative x) when closed and slides to x≈0 when open, then
 * auto-closes after navigating via a drawer link.
 */
test.describe('mobile nav drawer @mobile', () => {
  test('hamburger opens the drawer; a nav link navigates and auto-closes it', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin');

    const aside = page.locator('aside');

    // Closed: translated off-screen.
    expect((await aside.boundingBox())?.x ?? 0).toBeLessThan(0);

    // Open via the hamburger.
    await page.getByRole('button', { name: 'เปิดเมนู' }).click();
    await expect
      .poll(async () => (await aside.boundingBox())?.x ?? -999)
      .toBeGreaterThanOrEqual(-1);

    // Navigate via a drawer link.
    await page.getByRole('link', { name: 'พนักงาน' }).click();
    await page.waitForURL(/\/admin\/employees/);

    // Auto-closed after navigation.
    await expect.poll(async () => (await aside.boundingBox())?.x ?? 0).toBeLessThan(0);
  });
});
