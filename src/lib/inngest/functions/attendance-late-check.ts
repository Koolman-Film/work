/**
 * `attendance-late-check` — daily cron that summarizes who hasn't
 * checked in yet by the late-tolerance window.
 *
 * When: 10:00 Bangkok time daily (= 03:00 UTC). This is "9:00 schedule
 * start + 1hr buffer" for the customer's current Tue–Sun 09:00–18:00
 * shifts. Hardcoded for now; Phase 2 can derive from per-employee
 * WorkSchedule.lateToleranceMin.
 *
 * Emits ONE summary bell notification per day rather than per-employee.
 * Rationale: an admin overseeing 30 employees with 5 lates would
 * otherwise get 5 individual bell pings. The summary form + link to
 * /admin/attendance/live gives the same info without the spam.
 *
 * Sundays are skipped entirely (Koolman is closed Sundays — `CLOSED_DOW`
 * in working-days.ts). Holidays are also skipped (admins shouldn't see
 * "5 พนักงานยังไม่เช็คอินวันนี้" alerts on New Year's day).
 */

import { prisma } from '@/lib/db/prisma';
import { notifyAdminsInApp } from '@/lib/notifications/in-app-bell';
import { inngest } from '../client';

function bangkokTodayUtcMidnight(): Date {
  const ymd = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  return new Date(`${ymd}T00:00:00.000Z`);
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const attendanceLateCheck = inngest.createFunction(
  {
    id: 'attendance-late-check',
    triggers: [
      // 10:00 Bangkok daily = 03:00 UTC.
      { cron: 'TZ=Asia/Bangkok 0 10 * * *' },
    ],
  },
  async ({ step }) => {
    const today = bangkokTodayUtcMidnight();
    const todayDow = today.getUTCDay(); // 0=Sunday

    // Skip Sundays (company-wide closed day).
    if (todayDow === 0) {
      return { skipped: true, reason: 'sunday' };
    }

    // Skip holidays (any non-archived Holiday row for today).
    const isHoliday = await step.run('check-holiday', async () => {
      const h = await prisma.holiday.findFirst({
        where: { date: today, archivedAt: null },
        select: { name: true },
      });
      return h?.name ?? null;
    });
    if (isHoliday) {
      return { skipped: true, reason: 'holiday', holidayName: isHoliday };
    }

    // Find active employees + today's check-ins + today's approved leave.
    const [activeEmployees, checkedIn, onLeave] = await Promise.all([
      step.run('active-employees', async () =>
        prisma.employee.findMany({
          where: {
            archivedAt: null,
            status: { not: 'Archived' },
            canCheckIn: true,
          },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            nickname: true,
          },
        }),
      ),
      step.run('today-checkins', async () =>
        prisma.attendance.findMany({
          where: { date: today, type: 'CheckIn' },
          select: { employeeId: true },
        }),
      ),
      step.run('today-on-leave', async () =>
        prisma.attendance.findMany({
          where: { date: today, type: 'OnLeave' },
          select: { employeeId: true },
        }),
      ),
    ]);

    const checkedInSet = new Set(checkedIn.map((c) => c.employeeId));
    const onLeaveSet = new Set(onLeave.map((c) => c.employeeId));

    const notCheckedIn = activeEmployees.filter(
      (e) => !checkedInSet.has(e.id) && !onLeaveSet.has(e.id),
    );

    if (notCheckedIn.length === 0) {
      return { skipped: true, reason: 'all-checked-in' };
    }

    // Summary notification → admin bell. Names truncated to first 5 for
    // the snippet; full list lives on /admin/attendance/live.
    await step.run('notify-admins', async () => {
      await notifyAdminsInApp({
        kind: 'attendance.late-summary',
        date: ymd(today),
        countNotCheckedIn: notCheckedIn.length,
        sampleEmployeeNames: notCheckedIn
          .slice(0, 5)
          .map((e) => (e.nickname?.trim() || e.firstName).trim()),
      });
    });

    return {
      notified: true,
      countNotCheckedIn: notCheckedIn.length,
      activeEmployeeCount: activeEmployees.length,
    };
  },
);
