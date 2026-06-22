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

const TEST_DB = 'postgresql://postgres:postgres@127.0.0.1:54422/koolman_test';

export default defineConfig({
  resolve: { alias: { '@': resolve(__dirname, './src') } },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.integration.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      DATABASE_URL: TEST_DB,
      DIRECT_URL: TEST_DB,
    },
  },
});
