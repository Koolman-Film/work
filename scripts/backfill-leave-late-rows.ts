/**
 * CLI wrapper for `backfillLeaveLateRows` (src/lib/attendance/backfill-leave-late.ts)
 * — see that module for what the backfill actually does and why.
 *
 * There is also a Superadmin-gated admin page that runs the same core inside
 * the deployed app (src/app/(admin)/admin/tools/backfill-leave-late) — prefer
 * that one when possible, since it never requires handling a raw production
 * DB credential. Use this CLI only when you already have direct DB access
 * (e.g. local/staging) or the admin page isn't deployed yet.
 *
 * Dry-run by default (prints every candidate + planned action, mutates
 * nothing). Pass --apply to write. Optional --since=YYYY-MM-DD to scope.
 *
 * Needs PRODUCTION env. Run with:
 *   vercel env pull .env.production
 *   dotenv -e .env.production -- tsx scripts/backfill-leave-late-rows.ts                    # dry run
 *   dotenv -e .env.production -- tsx scripts/backfill-leave-late-rows.ts --since=2026-07-01 # scoped dry run
 *   dotenv -e .env.production -- tsx scripts/backfill-leave-late-rows.ts --since=2026-07-01 --apply
 */

import { backfillLeaveLateRows } from '@/lib/attendance/backfill-leave-late';
import { prisma } from '@/lib/db/prisma';

const iso = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  const apply = process.argv.includes('--apply');
  const sinceArg = process.argv.find((a) => a.startsWith('--since='))?.slice('--since='.length);
  const since = sinceArg ? new Date(`${sinceArg}T00:00:00.000Z`) : null;
  if (sinceArg && Number.isNaN(since!.getTime())) {
    console.error(`Bad --since=${sinceArg} (want YYYY-MM-DD)`);
    process.exit(1);
  }

  console.log(`\nBackfill leave-excused Late rows — ${apply ? 'APPLY' : 'DRY RUN'}`);
  console.log(since ? `Scope: date >= ${iso(since)}\n` : `Scope: ALL dates (consider --since)\n`);

  const report = await backfillLeaveLateRows({ apply, since });

  for (const c of report.changes) {
    const label =
      c.action === 'delete'
        ? 'DELETE'
        : c.action === 'lower'
          ? `LOWER ${c.storedMinutes}→${c.recomputedMinutes}`
          : c.action === 'skip-finalized'
            ? `SKIP(payroll-${c.payrollStatus}) ${c.storedMinutes}→${c.recomputedMinutes}`
            : 'SKIP(no CheckIn time)';
    console.log(`  ${c.date} emp=${c.employeeId} — ${label}`);
  }

  const k = report.counts;
  console.log(
    `\n${apply ? 'Applied' : 'Would'}: delete ${k.delete}, lower ${k.lower}; ` +
      `skipped(finalized) ${k.skippedFinalized}, missing-checkin ${k.missingCheckIn}, ` +
      `unchanged ${k.unchanged}, skipped(voided-concurrently) ${k.skippedConcurrent}.`,
  );
  if (!apply && k.delete + k.lower > 0) console.log('Re-run with --apply to write.\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
