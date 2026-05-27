/**
 * `attendance-force-checkout-eod` — daily cron that auto-closes
 * Attendance rows where the employee checked in but never tapped
 * check-out by end-of-day.
 *
 * When: 23:00 Bangkok time daily (= 16:00 UTC).
 *
 * Why: without this, stale "still working" rows pile up forever. The
 * live attendance board would show people as still on shift the next
 * morning, payroll math would be off, and admins would have to manually
 * close every forgotten check-out.
 *
 * Force-closed rows get clockOutAt = 22:00 BKK on the same day (a
 * conservative "they probably went home" timestamp). The audit log
 * captures actor=system + before/after so admins can find what got
 * auto-closed later via the records list.
 *
 * No notification is emitted — this is silent housekeeping. Admins who
 * want to see what changed can filter /admin/attendance by source=Liff
 * or look at the audit log.
 */

import { auditLog } from '@/lib/audit/log';
import { prisma } from '@/lib/db/prisma';
import { inngest } from '../client';

/** Today at UTC midnight, in Bangkok terms — matches @db.Date semantics. */
function bangkokTodayUtcMidnight(): Date {
  const ymd = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  return new Date(`${ymd}T00:00:00.000Z`);
}

/** 22:00 Bangkok time on a given UTC-midnight calendar date. */
function bangkok22Hour(date: Date): Date {
  // 22:00 BKK = 15:00 UTC same day. The calendar date in BKK is the UTC
  // midnight Date passed in (which represents the BKK calendar day).
  return new Date(date.getTime() + 15 * 60 * 60 * 1000);
}

export const attendanceForceCheckoutEod = inngest.createFunction(
  {
    id: 'attendance-force-checkout-eod',
    triggers: [
      // Inngest cron expressions support TZ prefix.
      // 0 23 * * * Asia/Bangkok = every day at 23:00 BKK = 16:00 UTC.
      { cron: 'TZ=Asia/Bangkok 0 23 * * *' },
    ],
  },
  async ({ step }) => {
    const today = bangkokTodayUtcMidnight();
    const forcedClockOut = bangkok22Hour(today);

    // Find today's open check-ins (clockOutAt still null).
    const openRows = await step.run('find-open-checkins', async () => {
      return prisma.attendance.findMany({
        where: {
          date: today,
          type: 'CheckIn',
          clockOutAt: null,
        },
        select: { id: true, employeeId: true, clockInAt: true },
      });
    });

    if (openRows.length === 0) {
      return { closed: 0 };
    }

    // Close each one. Sequential rather than parallel for transactional
    // audit-log ordering; volume is tiny (~tens/day max at Phase-1 scale).
    let closed = 0;
    for (const row of openRows) {
      await step.run(`close-${row.id}`, async () => {
        await prisma.attendance.update({
          where: { id: row.id },
          data: { clockOutAt: forcedClockOut },
        });
        auditLog({
          // No human actor — system action. Use a sentinel string the
          // audit viewer can render as "ระบบ".
          actorId: '00000000-0000-0000-0000-000000000000',
          action: 'attendance.force-checkout',
          entityType: 'Attendance',
          entityId: row.id,
          before: { clockOutAt: null },
          after: { clockOutAt: forcedClockOut.toISOString() },
          metadata: { source: 'cron', reason: 'eod-force-checkout' },
        });
      });
      closed++;
    }

    return { closed, forcedClockOutISO: forcedClockOut.toISOString() };
  },
);
