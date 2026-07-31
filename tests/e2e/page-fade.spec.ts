import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

/**
 * Page entrance animation on admin navigation.
 *
 * The whole design is one structural claim: `PageFade`'s keyed div is replaced
 * on every navigation while the surrounding layout is not. That split is what
 * makes the content fade while the sidebar, topbar and toasts hold still.
 *
 * It is also the only thing here that can silently break, and it breaks in the
 * direction that looks fine: drop the `key`, or swap `PageFade` back for the
 * `template.tsx` this design started with, and the animation plays on first
 * load and never again. Nothing throws; you just quietly lose the feature.
 *
 * So rather than sample opacity mid-flight — inherently racy — these tests
 * assert node identity across a client-side navigation: chrome must survive,
 * the wrapper must not.
 *
 * See docs/superpowers/specs/2026-07-31-page-fade-in-design.md.
 */

const WRAPPER = 'main > .u-enter-page';

/** Computed animation-duration of the page wrapper, in milliseconds. */
async function wrapperDurationMs(page: import('@playwright/test').Page) {
  return page.evaluate((selector) => {
    const el = document.querySelector(selector);
    if (!el) throw new Error(`no element matched ${selector}`);
    const raw = getComputedStyle(el).animationDuration.trim();
    // Browsers report either "0.32s" or "0.001ms"; normalise to ms.
    return raw.endsWith('ms') ? parseFloat(raw) : parseFloat(raw) * 1000;
  }, WRAPPER);
}

test.describe('admin page entrance', () => {
  test('navigation remounts the content wrapper but keeps the chrome', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin');

    await expect(page.locator(WRAPPER)).toBeAttached();

    // Stamp both nodes. Attributes set from JS survive React re-renders but
    // not a remount, which is exactly the distinction under test.
    await page.evaluate((selector) => {
      document.querySelector('aside')?.setAttribute('data-e2e-chrome', '1');
      document.querySelector(selector)?.setAttribute('data-e2e-wrapper', '1');
    }, WRAPPER);

    // Client-side navigation via the sidebar — not page.goto, which would do a
    // full document load and remount everything, proving nothing.
    await page.getByRole('link', { name: 'พนักงาน' }).click();
    await page.waitForURL(/\/admin\/employees/);
    await expect(page.locator(WRAPPER)).toBeAttached();

    // The layout persisted: same sidebar node, marker intact.
    await expect(page.locator('aside')).toHaveAttribute('data-e2e-chrome', '1');

    // The template did not: fresh wrapper node, so the CSS animation replayed.
    await expect(page.locator(WRAPPER)).not.toHaveAttribute('data-e2e-wrapper', '1');
  });

  test('the wrapper animates for its full duration', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin');

    // --duration-slow is 320ms. Assert a real animation is attached rather
    // than pinning the exact token, so retuning the token doesn't fail here.
    expect(await wrapperDurationMs(page)).toBeGreaterThan(100);
  });
});

test.describe('admin page entrance under reduced motion', () => {
  // Playwright 1.60 takes this via contextOptions, not as a top-level option.
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('the entrance collapses to instant', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin');

    await expect(page.locator(WRAPPER)).toBeAttached();
    // globals.css collapses every animation to 0.001ms under this media query.
    expect(await wrapperDurationMs(page)).toBeLessThanOrEqual(1);
  });
});
