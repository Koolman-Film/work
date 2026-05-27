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
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // Use the production-mode dev server output for stability — `next dev`
    // hot-reloads can race tests. But for now we accept that; W5 polish
    // pass might switch this to `next build && next start`.
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    // Skip reuseCheck in CI (where the server is fresh) but allow locally
    // so devs can keep `pnpm dev` running in another terminal.
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
