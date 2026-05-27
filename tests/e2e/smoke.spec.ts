import { expect, test } from '@playwright/test';

/**
 * Smoke — the cheapest possible verification that the server boots, the
 * landing page renders, and /login is reachable. If this fails, every
 * other spec will also fail; running this first surfaces "server didn't
 * start" cleanly.
 */

test.describe('smoke', () => {
  test('home page renders the scaffold-status block', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Koolman HR/i })).toBeVisible();
  });

  test('/login renders the login form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel(/อีเมล|email/i)).toBeVisible();
    await expect(page.getByLabel(/รหัสผ่าน|password/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /เข้าสู่ระบบ|sign in|login/i })).toBeVisible();
  });

  test('protected route redirects to /login when unauthed', async ({ page }) => {
    await page.goto('/admin/employees');
    // Proxy should redirect to /login with redirectTo set.
    await page.waitForURL(/\/login/, { timeout: 5_000 });
    const url = new URL(page.url());
    expect(url.searchParams.get('redirectTo')).toBe('/admin/employees');
  });
});
