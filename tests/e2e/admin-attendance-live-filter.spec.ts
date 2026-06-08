import { expect, test } from '@playwright/test';
import { Prisma } from '@prisma/client';
import { loginAsAdmin } from './helpers/auth';
import { cleanupE2eRecords, e2eId, prisma } from './helpers/db';

/**
 * Clickable dashboard KPIs → filtered live board. Seeds two e2e employees in
 * a fresh branch: one with a CheckIn for *today* (Bangkok) and one with no
 * attendance (so they're "not checked in"). Drives the real UI.
 */
test.describe('Live board KPI filters', () => {
  test.afterAll(async () => {
    await cleanupE2eRecords();
  });

  // today at UTC-midnight, matching @db.Date semantics (same as the loader).
  function todayUtcMidnight(): Date {
    const ymd = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
    return new Date(`${ymd}T00:00:00.000Z`);
  }
  function isSundayBangkok(): boolean {
    return todayUtcMidnight().getUTCDay() === 0;
  }

  async function seed(suffix: string) {
    const branch = await prisma.branch.create({
      data: {
        name: `e2e-Branch-${suffix}`,
        latitude: new Prisma.Decimal(13.7563),
        longitude: new Prisma.Decimal(100.5018),
        radiusMeters: 150,
      },
    });
    async function emp(tag: string) {
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
        },
      });
    }
    const present = await emp('Present');
    const absent = await emp('Absent');
    await prisma.attendance.create({
      data: {
        employeeId: present.id,
        date: todayUtcMidnight(),
        type: 'CheckIn',
        source: 'Liff',
        clockInAt: new Date(),
        checkInBranchId: branch.id,
        checkInStatus: 'Confirmed',
        createdById: present.userId,
      },
    });
    return { presentName: present.firstName, absentName: absent.firstName };
  }

  test('checked-in employee appears under ?filter=checkedin', async ({ page }) => {
    const { presentName, absentName } = await seed(e2eId());
    await loginAsAdmin(page);
    await page.goto('/admin/attendance/live?filter=checkedin');
    await expect(page.getByText(presentName, { exact: false })).toBeVisible();
    await expect(page.getByText(absentName, { exact: false })).toHaveCount(0);
  });

  test('not-checked-in employee appears under ?filter=notcheckedin', async ({ page }) => {
    test.skip(isSundayBangkok(), 'Closed day: not-checked-in list is empty by design');
    const { presentName, absentName } = await seed(e2eId());
    await loginAsAdmin(page);
    await page.goto('/admin/attendance/live?filter=notcheckedin');
    await expect(page.getByText(absentName, { exact: false })).toBeVisible();
    await expect(page.getByText(presentName, { exact: false })).toHaveCount(0);
  });

  test('dashboard เข้างานแล้ว figure links to the checked-in board', async ({ page }) => {
    await seed(e2eId());
    await loginAsAdmin(page);
    await page.goto('/admin');
    await page.getByRole('link', { name: 'ดูรายชื่อผู้ที่เข้างานแล้ว' }).click();
    await expect(page).toHaveURL(/\/admin\/attendance\/live\?filter=checkedin/);
  });
});
