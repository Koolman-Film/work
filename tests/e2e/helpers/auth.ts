/**
 * Admin login helper.
 *
 * Why we drive the real /login form instead of injecting a Supabase cookie:
 *   - The login flow itself is part of the contract under test; cookie-
 *     injection would bypass the password-grant path entirely. We want
 *     the test to fail loudly if /login regresses, not silently pass.
 *   - The cost is ~2 seconds per test for the round-trip. Acceptable.
 */

import type { Page } from '@playwright/test';

export const SEED_ADMIN = {
  email: 'admin@koolman.local',
  password: 'Admin_KMHR_temp_2026!',
} as const;

/**
 * Navigate to /login, fill credentials, submit, and wait for the redirect
 * to /admin. Throws if the redirect doesn't happen within 5 seconds.
 */
export async function loginAsAdmin(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/อีเมล|email/i).fill(SEED_ADMIN.email);
  await page.getByLabel(/รหัสผ่าน|password/i).fill(SEED_ADMIN.password);
  await page.getByRole('button', { name: /เข้าสู่ระบบ|sign in|login/i }).click();
  // The proxy redirects authed users hitting /login to /, which then routes
  // them to /admin via the role-aware home page. Wait for the URL to settle.
  await page.waitForURL(/\/admin($|\?|\/)/, { timeout: 8_000 });
}

/**
 * Worker (Staff) login for LIFF flows.
 *
 * Workers normally authenticate via LINE OIDC at /liff/pair, which Playwright
 * can't replay. Instead we POST to the test-only /api/test/session route,
 * which performs a real Supabase password sign-in and sets the session
 * cookies on the response. `page.request` shares the browser context's cookie
 * jar, so subsequent `page.goto` calls carry the session.
 *
 * Requires the dev server to run with `E2E_TEST_LOGIN=1` (set in
 * playwright.config's webServer.env). If you reuse a manually-started dev
 * server, start it with that flag or this throws a clear error.
 */
export async function loginAsWorker(
  page: Page,
  creds: { email: string; password: string },
): Promise<void> {
  const res = await page.request.post('/api/test/session', {
    data: { email: creds.email, password: creds.password },
  });
  if (!res.ok()) {
    throw new Error(
      `worker test-login failed (HTTP ${res.status()}). Is the dev server running with ` +
        `E2E_TEST_LOGIN=1? Response: ${await res.text()}`,
    );
  }
}
