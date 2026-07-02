import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Integration-test runner — exercises real service flows (payroll run/publish,
 * leave approval, …) against a DEDICATED local Postgres database, so the global
 * sweeps (advances/recurring) can never touch the demo `postgres` DB.
 *
 * Setup (one-time): create the `koolman_test` database on the local Supabase
 * Postgres, then migrate it:
 *   docker exec supabase_db_koolman_hr psql -U postgres -c "CREATE DATABASE koolman_test"
 *   pnpm run db:test:deploy
 * Then: pnpm run test:integration
 *
 * These tests share one DB, so they run serially (`fileParallelism: false`) and
 * each resets the transactional tables in `beforeEach`.
 */

// Local default = the koolman_test DB on the local Supabase Postgres.
// CI overrides via TEST_DATABASE_URL (a plain postgres service container).
const TEST_DB =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54422/koolman_test';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      // `server-only` throws on import outside React's server condition, which
      // vitest doesn't set. Map it to the package's own no-op (what the
      // react-server condition resolves to) so we can import server-only
      // service modules like reports/queries.ts directly.
      'server-only': resolve(__dirname, 'node_modules/server-only/empty.js'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.integration.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      DATABASE_URL: TEST_DB,
      DIRECT_URL: TEST_DB,
      // Required by mintMergeToken / verifyMergeToken in pairing/token.ts.
      // Value mirrors .env.local; override via CI env if needed.
      PAIRING_JWT_SECRET:
        process.env.PAIRING_JWT_SECRET ??
        'dz9XJ1u4kPnLBh5GZE3vTQyR0fOjN8VqMc6mIs7Wt2yAUDpHbgEC4wKxlie+S=YN',
    },
  },
});
