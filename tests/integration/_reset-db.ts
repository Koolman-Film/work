import { beforeAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';

/**
 * Cross-file isolation for the integration suite.
 *
 * These suites share ONE dedicated Postgres DB and run serially
 * (`fileParallelism: false`). Each file resets in `beforeEach`, but several
 * suites' resets delete `employee` / `user` / `branch` WITHOUT first clearing
 * their FK children (Payroll, LeaveRequest, LeaveEntitlement, …). The
 * `beforeEach(reset)` convention also leaves each file's LAST batch of rows in
 * the DB. So rows leaked by one file can FK-block the next file's teardown —
 * and because vitest's file order varies run-to-run, the failure was flaky.
 *
 * This setup file (registered via `setupFiles`) runs a FK-safe full truncate
 * once before every test file, so each suite starts from a guaranteed-clean DB
 * regardless of what ran before it. Individual files keep their `beforeEach`
 * reset for intra-file isolation.
 */
beforeAll(async () => {
  await prisma.$executeRawUnsafe(`
    DO $$
    DECLARE r RECORD;
    BEGIN
      SET session_replication_role = replica;
      FOR r IN (
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
      ) LOOP
        EXECUTE 'TRUNCATE TABLE public.' || quote_ident(r.tablename) || ' CASCADE';
      END LOOP;
      SET session_replication_role = DEFAULT;
    END $$;
  `);
});
