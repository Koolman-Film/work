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

      // Park the cursor off-content before measuring. `loginAsAdmin` ends in a
      // click, which leaves the pointer mid-viewport; after a goto it stays
      // there and lands on whatever now occupies that spot. On /admin/leave
      // that is a row with `hover:bg-surface-muted/70`, so the sweep measured
      // a randomly-hovered element and results flickered between runs.
      // A contrast audit must measure the page, not the cursor's resting place.
      await page.mouse.move(0, 0);

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
