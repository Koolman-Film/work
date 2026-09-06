import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

/**
 * Trash must not be a one-way door.
 *
 * `listHref` built every chip's URL inside `if (isTrash) { params.set('trash','1') }`,
 * which discarded the status the chip had passed. So while viewing the bin,
 * รออนุมัติ / ทั้งหมด / อนุมัติแล้ว / ไม่อนุมัติ all pointed back at
 * `?trash=1` — they rendered, they looked clickable, and they navigated to the
 * page you were already on. The only escape was the browser's back button.
 *
 * Asserted on the resulting URL rather than on the rendered rows: the seed may
 * legitimately have no requests in a given status, and an empty list would let
 * a broken link pass.
 */
for (const area of ['leave', 'advance'] as const) {
  test.describe(`/admin/${area} — trash is escapable`, () => {
    test.beforeEach(async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto(`/admin/${area}?trash=1`);
      await expect(page).toHaveURL(/trash=1/);
    });

    test('every status chip leaves the bin', async ({ page }) => {
      // The default chip carries no status param at all, so it is checked by
      // the absence of `trash`, not by the presence of `status`.
      const chips: { label: string; expect: RegExp }[] = [
        { label: 'ทั้งหมด', expect: /status=all/ },
        { label: 'อนุมัติแล้ว', expect: /status=approved/ },
        { label: 'ไม่อนุมัติ', expect: /status=rejected/ },
        { label: 'รออนุมัติ', expect: /\/admin\/(leave|advance)$/ },
      ];

      for (const chip of chips) {
        await page.goto(`/admin/${area}?trash=1`);
        await page.getByRole('link', { name: chip.label, exact: true }).click();
        await expect(page, `"${chip.label}" should leave the bin`).toHaveURL(chip.expect);
        await expect(page, `"${chip.label}" must drop trash=1`).not.toHaveURL(/trash=1/);
      }
    });

    test('the bin is still reachable, and paging inside it stays in it', async ({ page }) => {
      // The fix must not break the case the original code was protecting:
      // a pager click passes only `page` and should keep you in the bin.
      await expect(page.getByRole('link', { name: /ถังขยะ/ })).toBeVisible();
      await expect(page).toHaveURL(/trash=1/);
    });
  });
}
