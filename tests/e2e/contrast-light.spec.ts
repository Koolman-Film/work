import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';
import { ADMIN_PAGES, auditContrast } from './helpers/contrast';

/**
 * Every text token must clear WCAG AA against the background it actually
 * renders on — not against white, which is where this app's ink ramp was
 * originally checked and how `ink-3` came to pass at 4.76:1 on white while
 * failing at 4.47:1 on the `#f6f8fb` canvas it is really drawn on.
 *
 * Asserted from computed styles rather than by reading CSS, so it keeps
 * holding whichever token or utility reintroduces a low-contrast pair.
 */
test.describe('WCAG AA contrast — light mode, admin', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  for (const path of ADMIN_PAGES) {
    test(`${path} has no contrast failures`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(path);
      await page.waitForLoadState('networkidle');

      const { scanned, measured, failures } = await auditContrast(page);

      // A zero-failure result is only meaningful if the sweep actually ran.
      // An empty `failures` array and a crashed sweep look identical, and
      // that exact confusion once made 8 LIFF pages look perfect.
      expect(scanned, 'sweep found no elements — did the page render?').toBeGreaterThan(20);
      expect(measured, 'sweep measured no text — the harness is broken').toBeGreaterThan(3);

      expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
    });
  }
});
