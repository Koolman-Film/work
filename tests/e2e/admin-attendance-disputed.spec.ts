import { expect, test } from '@playwright/test';
import { Prisma } from '@prisma/client';
import { loginAsAdmin } from './helpers/auth';
import { cleanupE2eRecords, e2eId, prisma } from './helpers/db';

/**
 * Disputed check-in review (master-detail). Seeds a Disputed CheckIn, drives
 * the UI (select row → note → approve/reject), and asserts checkInStatus via
 * Prisma. The row leaves the list on success (router.refresh).
 */
test.describe('Admin disputed check-in review', () => {
  test.afterAll(async () => {
    await cleanupE2eRecords();
  });

  async function seedDisputed(suffix: string) {
    const branch = await prisma.branch.create({
      data: {
        name: `e2e-Branch-${suffix}`,
        latitude: new Prisma.Decimal(13.7563),
        longitude: new Prisma.Decimal(100.5018),
        radiusMeters: 150,
      },
    });
    const user = await prisma.user.create({ data: {} });
    const employee = await prisma.employee.create({
      data: {
        userId: user.id,
        firstName: `e2e-First-${suffix}`,
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
    const att = await prisma.attendance.create({
      data: {
        employeeId: employee.id,
        date: new Date('2026-06-05T00:00:00.000Z'),
        type: 'CheckIn',
        source: 'Liff',
        clockInAt: new Date('2026-06-05T02:00:00.000Z'),
        checkInLat: new Prisma.Decimal(13.7585),
        checkInLng: new Prisma.Decimal(100.5028),
        checkInBranchId: branch.id,
        checkInStatus: 'Disputed',
        disputeReason: `e2e dispute ${suffix}`,
        createdById: user.id,
      },
    });
    return { att };
  }

  test('approve a disputed check-in → checkInStatus=Confirmed', async ({ page }) => {
    const suffix = e2eId();
    const { att } = await seedDisputed(suffix);

    await loginAsAdmin(page);
    await page.goto('/admin/attendance/disputed');
    await expect(page.getByRole('heading', { name: 'ต้องตรวจสอบ' })).toBeVisible();

    await page
      .getByRole('button', { name: new RegExp(suffix) })
      .first()
      .click();
    await page.getByRole('textbox').fill('e2e — verified by Playwright');
    await page.getByRole('button', { name: /อนุมัติเป็นปกติ/ }).click();

    await expect(page.getByRole('button', { name: new RegExp(suffix) })).toHaveCount(0, {
      timeout: 5_000,
    });
    const refreshed = await prisma.attendance.findUnique({
      where: { id: att.id },
      select: { checkInStatus: true },
    });
    expect(refreshed?.checkInStatus).toBe('Confirmed');
  });

  test('reject a disputed check-in → checkInStatus=Rejected', async ({ page }) => {
    const suffix = e2eId();
    const { att } = await seedDisputed(suffix);

    await loginAsAdmin(page);
    await page.goto('/admin/attendance/disputed');

    await page
      .getByRole('button', { name: new RegExp(suffix) })
      .first()
      .click();
    await page.getByRole('textbox').fill('e2e — rejected');
    await page.getByRole('button', { name: /ไม่อนุมัติ/ }).click();

    await expect(page.getByRole('button', { name: new RegExp(suffix) })).toHaveCount(0, {
      timeout: 5_000,
    });
    const refreshed = await prisma.attendance.findUnique({
      where: { id: att.id },
      select: { checkInStatus: true },
    });
    expect(refreshed?.checkInStatus).toBe('Rejected');
  });
});
