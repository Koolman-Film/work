import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';
import { ADMIN_PAGES, auditContrast } from './helpers/contrast';

/**
 * The same AA bar as light mode, applied to the dark palette.
 *
 * Uses `colorScheme: 'dark'` rather than the cookie, so this exercises the
 * `@media (prefers-color-scheme: dark)` copy of the theme — the one that runs
 * for visitors who never touch the toggle, which is most of them.
 */
test.describe('WCAG AA contrast — dark mode, admin', () => {
  test.use({ colorScheme: 'dark' });

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  for (const path of ADMIN_PAGES) {
    test(`${path} has no contrast failures in dark`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await page.mouse.move(0, 0);

      // Assert the dark palette actually applied. Without this a failure to
      // match the media query would silently re-test the light palette and
      // report a comfortable pass.
      const canvas = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--color-canvas').trim(),
      );
      expect(canvas, 'dark palette did not apply — this ran against light').toBe('#101317');

      const { scanned, measured, failures } = await auditContrast(page);
      expect(scanned, 'sweep found no elements — did the page render?').toBeGreaterThan(20);
      expect(measured, 'sweep measured no text — the harness is broken').toBeGreaterThan(3);

      expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
    });
  }
});
