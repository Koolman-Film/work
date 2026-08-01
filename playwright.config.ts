/**
 * Playwright config — integration tests for Koolman HR.
 *
 * Strategy:
 *   - Tests run against the dev server (http://localhost:3000) using the
 *     dev Supabase project. They create entities with unique e2e-prefixed
 *     names and clean up after themselves where possible.
 *   - Single project (Chromium) for now — adding Firefox/WebKit triples
 *     CI time and we're not shipping multi-browser specs yet.
 *   - Sequential by default (workers: 1) because we share the dev DB; a
 *     test creating "e2e-branch-X" and another deleting it would race.
 *     When we eventually graduate to a proper test DB, lift this.
 *
 * See tests/e2e/README.md for setup notes.
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // LIFF specs drive flows that authenticate against a real LINE channel —
  // LIFF_ID, the messaging channel secret, the registered redirect URI. CI has
  // none of those (they are production credentials, not test fixtures), so
  // those specs would fail on the environment rather than on the code. They
  // still run locally against .env.local, which has the real values.
  //
  // Everything else — the admin suite, where the regression tests live — needs
  // only Supabase + Postgres, both of which CI can stand up.
  testIgnore: process.env.CI ? ['**/liff-*.spec.ts'] : [],
  // Don't bail the whole suite on a single failure; we want the full
  // picture, not a stop-on-first-error.
  fullyParallel: false,
  workers: 1,
  // CI gets retries to absorb network flakes; locally we want fast feedback.
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    // Capture trace on first retry — costs nothing on green runs, gives
    // us full UI timeline when something fails.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      // Desktop: runs every spec EXCEPT ones tagged @mobile (those assume a
      // phone viewport and would fail full-width).
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      grepInvert: /@mobile/,
    },
    {
      // Mobile: runs ONLY @mobile-tagged tests, at a phone viewport. Existing
      // untagged specs are skipped here so they keep their desktop assumptions.
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      grep: /@mobile/,
    },
  ],
  webServer: {
    // Locally `next dev` keeps the edit-run loop fast and its hot-reload races
    // are tolerable. CI builds first: `next dev` compiles each route on first
    // request, so the opening test of every spec pays a multi-second compile
    // and trips its own timeout on a cold runner. Build once, serve fast.
    command: process.env.CI ? 'pnpm build && pnpm start' : 'pnpm dev',
    url: 'http://localhost:3000',
    // Skip reuseCheck in CI (where the server is fresh) but allow locally
    // so devs can keep `pnpm dev` running in another terminal.
    reuseExistingServer: !process.env.CI,
    // CI builds the app first, so it needs materially longer than a dev boot.
    timeout: process.env.CI ? 420_000 : 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    // Enable the test-only /api/test/session login route (used by the LIFF
    // worker specs). The route is also gated on NODE_ENV !== 'production'.
    // NOTE: a manually-started reused dev server won't inherit this — start it
    // with E2E_TEST_LOGIN=1 if you run the worker specs against your own server.
    env: { E2E_TEST_LOGIN: '1' },
  },
});
