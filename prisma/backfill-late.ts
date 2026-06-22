/**
 * Backfill `Late` attendance rows for historical LINE check-ins.
 *
 * Before the late-arrival policy existed, a late check-in only produced a
 * `CheckIn` row — so the report, the history "มาสาย" filter, and payroll all
 * saw 0 lates. This one-off, IDEMPOTENT script walks every non-deleted
 * `CheckIn` and creates the missing `Late` row (company default start + grace)
 * when the clock-in was late on a working day.
 *
 * Run:  pnpm exec dotenv -e .env.local -- tsx prisma/backfill-late.ts
 * Safe to re-run: skips check-ins that already have a Late row for the day.
 *
 * NOTE: this creates Late rows, which payroll's per-Late `lateDeduction`
 * counts. Recalculating an already-published month after a backfill will pull
 * these deductions in — intended, but worth telling the customer before you
 * run it against production.
 */

// biome-ignore-all lint/suspicious/noConsole: one-off CLI script — console is the output channel

import { PrismaClient } from '@prisma/client';
import { isClosedDay } from '../src/lib/attendance/date';
import { lateMinutesForCheckIn, latePolicyFrom } from '../src/lib/attendance/late-policy';

const prisma = new PrismaClient();

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function main() {
  const policy = latePolicyFrom(
    await prisma.payrollConfig.findFirst({
      select: { workStartTime: true, lateGraceMinutes: true },
    }),
  );
  console.log(`Late backfill — policy: start ${policy.startTime} + ${policy.graceMin}m grace\n`);

  const [checkIns, holidayRows] = await Promise.all([
    prisma.attendance.findMany({
      where: { type: 'CheckIn', deletedAt: null, clockInAt: { not: null } },
      select: { employeeId: true, date: true, clockInAt: true, createdById: true },
      orderBy: { date: 'asc' },
    }),
    prisma.holiday.findMany({ where: { archivedAt: null }, select: { date: true } }),
  ]);
  const holidaySet = new Set(holidayRows.map((h) => ymd(h.date)));

  let created = 0;
  let skippedExisting = 0;
  let notLate = 0;
  let closedDay = 0;

  for (const ci of checkIns) {
    if (!ci.clockInAt) continue;
    const hasHoliday = holidaySet.has(ymd(ci.date));
    if (isClosedDay(ci.date, hasHoliday)) {
      closedDay++;
      continue;
    }
    const lateMinutes = lateMinutesForCheckIn(ci.clockInAt, policy);
    if (lateMinutes <= 0) {
      notLate++;
      continue;
    }
    const existing = await prisma.attendance.findFirst({
      where: { employeeId: ci.employeeId, date: ci.date, type: 'Late', deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      skippedExisting++;
      continue;
    }
    await prisma.attendance.create({
      data: {
        employeeId: ci.employeeId,
        date: ci.date,
        type: 'Late',
        source: 'Liff',
        durationMinutes: lateMinutes,
        createdById: ci.createdById,
      },
    });
    created++;
  }

  console.log(`CheckIns scanned : ${checkIns.length}`);
  console.log(`Late rows created: ${created}`);
  console.log(`Already had Late : ${skippedExisting}`);
  console.log(`On time / grace  : ${notLate}`);
  console.log(`Closed day (skip): ${closedDay}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
