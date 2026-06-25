/**
 * Backfill `chargedMinutes` for approved leave requests that are missing it.
 *
 * The leave report + balance read the frozen `LeaveRequest.chargedMinutes`
 * snapshot. The live approval path (`approveLeaveRequest`) always freezes it,
 * but rows created another way (seed / import / migration) can have it null —
 * and a null snapshot is summed as 0, so the approved leave silently vanishes
 * from reports and balances (while the detail modal, which recomputes live,
 * still shows the right day-count). This IDEMPOTENT script recomputes the
 * snapshot with the EXACT logic approval uses: segment.minutes × working-days
 * (Sundays + holidays excluded, per LeaveConfig).
 *
 * Run:  pnpm exec dotenv -e .env.local -- tsx prisma/backfill-leave-charged.ts
 * Safe to re-run: only touches approved rows where chargedMinutes IS NULL.
 */

// biome-ignore-all lint/suspicious/noConsole: one-off CLI script — console is the output channel

import { PrismaClient } from '@prisma/client';
import { segmentFor } from '../src/lib/leave/units';
import { expandHolidaysWithSubstitutes, workingDaysIn } from '../src/lib/leave/working-days';

const prisma = new PrismaClient();

// LeaveConfig defaults, mirroring the schema @default values, for the rare
// case the singleton row hasn't been seeded yet.
const CFG_FALLBACK = {
  morningStart: '09:00',
  morningEnd: '12:00',
  afternoonStart: '13:00',
  afternoonEnd: '17:00',
};

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  if (DRY_RUN) console.log('— DRY RUN — no rows will be written —\n');
  const cfg = (await prisma.leaveConfig.findFirst()) ?? CFG_FALLBACK;

  const [rows, holidayRows] = await Promise.all([
    prisma.leaveRequest.findMany({
      where: { status: 'Approved', deletedAt: null, chargedMinutes: null },
      select: {
        id: true,
        startDate: true,
        endDate: true,
        unit: true,
        startTime: true,
        endTime: true,
      },
      orderBy: { startDate: 'asc' },
    }),
    prisma.holiday.findMany({ where: { archivedAt: null }, select: { date: true } }),
  ]);
  const allHolidays = holidayRows.map((h) => h.date);

  let updated = 0;
  let badSegment = 0;

  for (const r of rows) {
    const segment = segmentFor(r.unit, cfg, r.startTime, r.endTime);
    if (!segment) {
      badSegment++;
      continue;
    }
    // Match approval's holiday window: [startDate − 1 day, endDate], so a
    // Sunday holiday just before the range still yields its Monday substitute.
    const dayBeforeStart = new Date(r.startDate.getTime() - 86_400_000);
    const inWindow = allHolidays.filter(
      (d) => d.getTime() >= dayBeforeStart.getTime() && d.getTime() <= r.endDate.getTime(),
    );
    const expanded = expandHolidaysWithSubstitutes(inWindow);
    const workingDays = workingDaysIn({
      startDate: r.startDate,
      endDate: r.endDate,
      holidays: expanded,
    });
    const chargedMinutes = segment.minutes * workingDays.length;
    if (DRY_RUN) {
      console.log(
        `  [${r.id.slice(0, 8)}] ${r.startDate.toISOString().slice(0, 10)}..${r.endDate.toISOString().slice(0, 10)} ${r.unit} → chargedMinutes=${chargedMinutes} (${workingDays.length} day(s) × ${segment.minutes}m)`,
      );
    } else {
      await prisma.leaveRequest.update({ where: { id: r.id }, data: { chargedMinutes } });
    }
    updated++;
  }

  console.log(`\nApproved leaves missing chargedMinutes: ${rows.length}`);
  console.log(`  ${DRY_RUN ? 'would backfill' : 'backfilled'} : ${updated}`);
  console.log(`  bad segment (skipped, invalid times): ${badSegment}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
