import { expect, test } from '@playwright/test';
import { loginAsAdmin, SEED_ADMIN } from './helpers/auth';

/**
 * Auth flow — admin can log in with seed credentials, lands on /admin,
 * and can log out.
 *
 * This is the "if /login regresses, everything else fails" test. Keep it
 * dead simple — no DB seeding, no entity creation.
 */

test.describe('auth', () => {
  test('admin can log in with seed credentials and lands on /admin', async ({ page }) => {
    await loginAsAdmin(page);
    expect(page.url()).toMatch(/\/admin(\?|$|\/)/);
    // Admin dashboard h1 is "ภาพรวม" (overview); the sidebar shows
    // "แผงควบคุมผู้ดูแล" — either signals we landed on the admin shell.
    await expect(page.getByRole('heading', { name: 'ภาพรวม' })).toBeVisible({
      timeout: 5_000,
    });
  });

  test('bad password rejected without revealing which field was wrong', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/อีเมล|email/i).fill(SEED_ADMIN.email);
    await page.getByLabel(/รหัสผ่าน|password/i).fill('definitely-wrong-password');
    await page.getByRole('button', { name: /เข้าสู่ระบบ|sign in|login/i }).click();

    // Anti-enumeration policy (W1b: src/lib/auth/login-error.ts) demands
    // the same generic Thai message for invalid_credentials regardless of
    // whether the email or password was wrong.
    await expect(page.getByText(/อีเมลหรือรหัสผ่านไม่ถูกต้อง/)).toBeVisible({
      timeout: 5_000,
    });
    // Still on /login (no redirect).
    expect(page.url()).toContain('/login');
  });

  test('authed user hitting /login is bounced to /', async ({ page }) => {
    await loginAsAdmin(page);
    // Navigate back to /login while authed.
    await page.goto('/login');
    // Proxy bounces to / which then routes to /admin.
    await page.waitForURL(/\/admin/, { timeout: 5_000 });
  });
});
