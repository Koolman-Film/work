import { expect, test } from '@playwright/test';
import { loginAsWorker } from './helpers/auth';
import { auditContrast, LIFF_PAGES } from './helpers/contrast';
import { cleanupE2eRecords, createE2eWorker } from './helpers/db';

/**
 * WCAG AA on the worker-facing LIFF pages, in both themes, at phone width.
 *
 * These matter more than the admin screens: 50 people read them on their own
 * phones, in bright sun and at 5am, inside LINE's in-app browser. The failure
 * that started this whole piece of work lived here — "Not checked in yet", the
 * primary status on the check-in screen, at 2.56:1.
 *
 * Named `liff-*` deliberately: playwright.config skips that prefix in CI,
 * where the test-login route and LINE credentials are not available.
 */
for (const scheme of ['light', 'dark'] as const) {
  test.describe(`WCAG AA contrast — ${scheme} mode, LIFF`, () => {
    test.use({ colorScheme: scheme });

    test.beforeEach(async ({ page }) => {
      const worker = await createE2eWorker({});
      await loginAsWorker(page, { email: worker.email, password: worker.password });
    });

    test.afterAll(async () => {
      await cleanupE2eRecords();
    });

    for (const path of LIFF_PAGES) {
      test(`${path} has no contrast failures in ${scheme}`, async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 812 });
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        // See contrast-light.spec.ts: a parked cursor otherwise makes the sweep
        // measure whichever element it happens to rest on.
        await page.mouse.move(0, 0);

        // Assert the intended palette actually applied, so a theme that failed
        // to load cannot masquerade as a comfortable pass on the other one.
        const canvas = await page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--color-canvas').trim(),
        );
        expect(canvas, `${scheme} palette did not apply`).toBe(
          scheme === 'dark' ? '#101317' : '#f6f8fb',
        );

        const { scanned, measured, failures } = await auditContrast(page);
        expect(scanned, 'sweep found no elements — did the page render?').toBeGreaterThan(20);
        expect(measured, 'sweep measured no text — the harness is broken').toBeGreaterThan(3);

        expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
      });
    }
  });
}
