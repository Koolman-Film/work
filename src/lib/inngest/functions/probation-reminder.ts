/**
 * `probation-reminder` — daily cron that notifies admins about
 * employees whose 4-month probation ends in exactly 7 days.
 *
 * When: 09:00 Bangkok time daily (= 02:00 UTC).
 *
 * Why 7 days lead: gives the admin a week to schedule the
 * probation-end conversation, run a review, and decide whether to
 * convert to permanent / extend probation / terminate. Hardcoded for
 * V1; Phase 2 can make `probationDays` configurable per employee or
 * per company.
 *
 * Volume is typically 0-1 per day (most small companies don't hire
 * multiple people in the same week), so we emit one bell notification
 * per qualifying employee rather than a summary. If a customer ever
 * onboards 10 people on the same day we'll revisit.
 */

import { prisma } from '@/lib/db/prisma';
import { notifyAdminsInApp } from '@/lib/notifications/in-app-bell';
import { inngest } from '../client';

/** 4 months in days — Thai labor law standard probation period. */
const PROBATION_DAYS = 120;
/** Lead-time before probation end. */
const NOTICE_DAYS = 7;

function bangkokTodayUtcMidnight(): Date {
  const ymd = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  return new Date(`${ymd}T00:00:00.000Z`);
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const probationReminder = inngest.createFunction(
  {
    id: 'probation-reminder',
    triggers: [{ cron: 'TZ=Asia/Bangkok 0 9 * * *' }],
  },
  async ({ step }) => {
    const today = bangkokTodayUtcMidnight();

    // We want employees whose `hiredAt + PROBATION_DAYS = today + NOTICE_DAYS`.
    // Rearranged: `hiredAt = today + NOTICE_DAYS - PROBATION_DAYS`.
    // So we look for employees hired exactly (PROBATION_DAYS - NOTICE_DAYS)
    // = 113 days ago.
    const targetHireDate = new Date(today.getTime() - (PROBATION_DAYS - NOTICE_DAYS) * 86_400_000);
    const targetEndDate = new Date(today.getTime() + NOTICE_DAYS * 86_400_000);

    const due = await step.run('find-due', async () => {
      // Date-only equality: `hiredAt` is @db.Date, stored as UTC midnight.
      return prisma.employee.findMany({
        where: {
          archivedAt: null,
          status: { not: 'Archived' },
          hiredAt: targetHireDate,
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          nickname: true,
        },
      });
    });

    if (due.length === 0) {
      return { notified: 0 };
    }

    // One notification per employee.
    for (const emp of due) {
      const displayName = emp.nickname?.trim() || `${emp.firstName} ${emp.lastName}`.trim();
      await step.run(`notify-${emp.id}`, async () => {
        await notifyAdminsInApp({
          kind: 'probation.ending',
          employeeId: emp.id,
          employeeName: displayName,
          endDate: ymd(targetEndDate),
          daysRemaining: NOTICE_DAYS,
        });
      });
    }

    return {
      notified: due.length,
      employeeIds: due.map((e) => e.id),
    };
  },
);
