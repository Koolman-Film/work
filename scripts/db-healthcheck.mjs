/**
 * Post-migration DB health check — runs in the deploy pipeline right after
 * `prisma migrate deploy` (see package.json "build").
 *
 * Why this exists: Postgres does NOT track column dependencies inside function
 * bodies, so a migration that drops/renames a column can silently break a
 * SECURITY DEFINER RLS helper — it stays "valid" in the catalog and only throws
 * at execution time, deep inside an RLS policy, for end users. (That is exactly
 * how `is_admin_or_owner` broke when User.role was dropped — see migration
 * 0022.) This guard EXECUTES those functions during the deploy, so any such
 * breakage fails the build loudly instead of reaching an admin in production.
 *
 * When you add a new RLS / SECURITY DEFINER helper function, add it to CHECKS.
 */
import { PrismaClient } from '@prisma/client';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/** Each entry: a label + a side-effect-free SQL that forces the function to
 *  plan + execute. A no-match uuid is fine — we only care it doesn't throw. */
const CHECKS = [
  {
    name: 'is_admin_or_owner(uuid)',
    sql: `SELECT public.is_admin_or_owner('${NIL_UUID}'::uuid)`,
  },
];

const prisma = new PrismaClient();
let failed = 0;

for (const check of CHECKS) {
  try {
    await prisma.$queryRawUnsafe(check.sql);
    console.log(`  ✓ ${check.name}`);
  } catch (err) {
    failed += 1;
    console.error(`  ✗ ${check.name}\n    ${err instanceof Error ? err.message : String(err)}`);
  }
}

await prisma.$disconnect();

if (failed > 0) {
  console.error(
    `\n✗ db-healthcheck: ${failed} RLS function check(s) failed — a schema change broke a` +
      ` SECURITY DEFINER / RLS function. Refusing to ship a deploy that breaks admins.`,
  );
  process.exit(1);
}
console.log('✓ db-healthcheck: all RLS function checks passed');
