import { expect, test } from '@playwright/test';

/**
 * LIFF admin smoke — unauthenticated visitors must never see admin content.
 *
 * /liff/admin/inbox is gated server-side by requireLiffAdmin() → notFound(),
 * and the proxy carves /liff/admin out of the /login redirect so the client
 * LiffSessionGate gets a chance to bootstrap a LINE session. Outside the LINE
 * webview (as in this test) the gate ends in its error state. Either way the
 * admin inbox content ("งานรออนุมัติ") must not render.
 */

test.describe('liff admin gate', () => {
  test('GET /liff/admin/inbox without a session does not render admin content', async ({
    page,
  }) => {
    await page.goto('/liff/admin/inbox');

    // No redirect to /login — the proxy exempts /liff/admin.
    expect(new URL(page.url()).pathname).toBe('/liff/admin/inbox');

    // The admin inbox heading must never appear without a session.
    await expect(page.getByRole('heading', { name: 'งานรออนุมัติ' })).toHaveCount(0);

    // The gate shows checking, then (no LIFF outside LINE) its error message.
    await expect(
      page.getByText(/กำลังเข้าสู่ระบบ|กรุณาเปิดลิงก์นี้ในแอป LINE|เข้าสู่ระบบไม่สำเร็จ/),
    ).toBeVisible();
  });
});
