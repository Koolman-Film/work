import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Vitest config — unit-test runner.
 *
 * Scope: pure-function unit tests only (Tier 1). Integration tests against
 * a live DB are deferred — they need a Supabase CLI local stack or a
 * dedicated test schema, not in scope yet.
 *
 * Conventions:
 *   - Test files live next to source: `foo.ts` ↔ `foo.test.ts`
 *   - `environment: 'node'` because we're testing server-only helpers; no
 *     DOM needed. Add 'happy-dom' later if we test React components.
 *   - Path alias `@/*` mirrors tsconfig.json so imports work identically
 *     in source and tests.
 *   - `env` block injects fixed test values so tests don't depend on
 *     `.env.local` being present (CI runs without it).
 */

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    env: {
      // Deterministic secret for token tests — never used in real signing
      PAIRING_JWT_SECRET: 'test-only-deterministic-secret-32chars+',
    },
  },
});
