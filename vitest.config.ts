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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Scope to the domain logic unit tests target. The app/ UI tree (pages,
      // components, server actions) is exercised by e2e, which v8 unit coverage
      // can't measure — including it would just drown the number in untestable
      // React. Pure/near-pure app helpers can be added here individually later.
      include: ['src/lib/**/*.ts'],
      // Tests, generated types, and pure wiring/clients aren't meaningful targets.
      exclude: [
        'src/lib/**/*.test.ts',
        'src/lib/**/*.d.ts',
        'src/lib/db/prisma.ts',
        'src/lib/supabase/**',
        'src/lib/inngest/client.ts',
      ],
    },
  },
});
