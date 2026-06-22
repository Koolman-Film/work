import { expect, test } from '@playwright/test';
import { Prisma } from '@prisma/client';
import { loginAsAdmin } from './helpers/auth';
import { cleanupE2eRecords, e2eId, prisma } from './helpers/db';

/**
 * Schedule-aware "ยังไม่เช็คอิน": an employee scheduled OFF today must not be
 * flagged as not-checked-in on the live board, while a default-schedule
 * colleague (Mon–Sat) is. This is the พี่แดง (Mon/Wed/Fri on a Saturday) bug.
 *
 * Deterministic regardless of the day it runs: the "off" employee gets a
 * WorkSchedule covering every weekday EXCEPT today; the "on" employee has no
 * schedule (company default Mon–Sat). Skipped on Sunday, when even the default
 * employee is off.
 */
test.describe('Live board respects per-employee work schedule', () => {
  const suffix = e2eId();
  let scheduleId: string | null = null;

  test.afterAll(async () => {
    await cleanupE2eRecords(); // removes the e2e employees first (FK Restrict)
    if (scheduleId) {
      await prisma.workSchedule.deleteMany({ where: { name: { startsWith: 'e2e-' } } });
    }
  });

  function todayUtcMidnight(): Date {
    const ymd = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
    return new Date(`${ymd}T00:00:00.000Z`);
  }

  test('off-schedule employee is excluded from not-checked-in', async ({ page }) => {
    const todayDow = todayUtcMidnight().getUTCDay();
    test.skip(todayDow === 0, 'Sunday — the default-schedule employee is also off');

    const branch = await prisma.branch.create({ data: { name: `e2e-Branch-${suffix}` } });

    // A schedule for every weekday EXCEPT today → its holder is off today.
    const otherDows = [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== todayDow);
    const schedule = await prisma.workSchedule.create({
      data: {
        name: `e2e-Sched-${suffix}`,
        days: {
          create: otherDows.map((d) => ({ dayOfWeek: d, startTime: '09:00', endTime: '18:00' })),
        },
      },
    });
    scheduleId = schedule.id;

    async function emp(tag: string, workScheduleId: string | null) {
      const user = await prisma.user.create({ data: {} });
      return prisma.employee.create({
        data: {
          userId: user.id,
          firstName: `e2e-${tag}-${suffix}`,
          lastName: `e2e-Last-${suffix}`,
          branchId: branch.id,
          assignedBranchIds: [branch.id],
          salaryType: 'Monthly',
          baseSalary: new Prisma.Decimal(20_000),
          status: 'Active',
          canCheckIn: true,
          hiredAt: new Date('2026-01-01'),
          workScheduleId,
        },
      });
    }
    // Neither checks in today.
    const offToday = await emp('OffToday', schedule.id);
    const onToday = await emp('OnToday', null); // no schedule → default Mon–Sat

    await loginAsAdmin(page);
    await page.goto('/admin/attendance/live?filter=notcheckedin');
    await page.waitForLoadState('networkidle');

    const body = page.locator('body');
    // The default-schedule employee IS expected today → shown as not-checked-in.
    await expect(body).toContainText(`e2e-OnToday-${suffix}`);
    // The off-schedule employee is NOT expected today → absent from the list.
    await expect(body).not.toContainText(`e2e-OffToday-${suffix}`);

    // Sanity: ids referenced so lint doesn't flag unused.
    expect(offToday.id).not.toBe(onToday.id);
  });
});
