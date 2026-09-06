import { expect, type Page, test } from '@playwright/test';
import { THEME_COOKIE_NAME } from '../../src/lib/theme/config';
import { loginAsAdmin } from './helpers/auth';

/**
 * The toggle's whole reason to live on the server: the choice must be applied
 * by the SERVER on the next request, so the theme is right in the first byte
 * of HTML rather than corrected by a script after first paint.
 *
 * Asserted on `<html data-theme>` because that is what the layout stamps.
 * Checking a rendered colour instead would pass even if a client script had
 * patched it in after exactly the flash this design exists to prevent.
 *
 * Options are selected by `data-theme-option`, not by accessible name: the
 * name is translated into six locales and the session's language varies.
 */
const pick = (value: 'light' | 'dark' | 'system') => `[data-theme-option="${value}"]`;

/**
 * Click an option and wait until React has actually handled it.
 *
 * The buttons are present in the SSR HTML before hydration attaches their
 * onClick, and Playwright clicks as soon as an element is visible and
 * enabled — so an early click lands on inert markup and is silently lost.
 * Retrying until `aria-pressed` flips proves the handler ran, rather than
 * assuming it did.
 */
async function choose(page: Page, value: 'light' | 'dark' | 'system') {
  await expect(async () => {
    await page.click(pick(value));
    await expect(page.locator(pick(value))).toHaveAttribute('aria-pressed', 'true');
  }).toPass({ timeout: 15_000 });

  // Then wait for the SERVER to catch up. The click only updates optimistic
  // client state; setTheme is still in flight, and reloading here aborts it
  // mid-request (the dev server logs ECONNRESET) so the cookie never lands.
  // <html data-theme> only changes once revalidatePath has re-rendered the
  // layout, which is the behaviour actually under test.
  if (value === 'system') {
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.*/);
  } else {
    await expect(page.locator('html')).toHaveAttribute('data-theme', value);
  }
}

test.describe('theme toggle', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin');
  });

  test('persists an explicit choice across a reload', async ({ page }) => {
    await choose(page, 'dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    const canvas = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--color-canvas').trim(),
    );
    expect(canvas, 'the dark palette should have followed the attribute').toBe('#101317');
  });

  test('switching back to system removes the attribute entirely', async ({ page }) => {
    await choose(page, 'dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await choose(page, 'system');
    await page.reload();

    // No attribute at all. That omission is what lets prefers-color-scheme
    // resolve before first paint, with no cookie read and no script.
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.*/);
  });

  test('an explicit Light choice wins on a dark OS', async ({ page, context }) => {
    // The `:not([data-theme='light'])` guard exists for exactly this case.
    // Without it the media query still wins and picking Light does nothing.
    //
    // Only the THEME cookie is cleared — clearing all of them would drop the
    // session and bounce us to /login.
    const cookies = await context.cookies();
    await context.clearCookies();
    await context.addCookies(cookies.filter((c) => c.name !== THEME_COOKIE_NAME));

    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/admin');
    await choose(page, 'light');
    await page.reload();

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    const canvas = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--color-canvas').trim(),
    );
    expect(canvas, 'explicit Light must beat a dark OS preference').toBe('#f6f8fb');
  });
});
