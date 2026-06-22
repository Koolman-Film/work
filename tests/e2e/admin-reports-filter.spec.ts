import { expect, test } from '@playwright/test';
import { Prisma } from '@prisma/client';
import { loginAsAdmin } from './helpers/auth';
import { cleanupE2eRecords, e2eId, prisma } from './helpers/db';

/**
 * Branch filter on the attendance report: filtering by a branch shows only that
 * branch's employees. Seeds two e2e employees in two e2e branches.
 */
test.describe('Reports branch filter', () => {
  const suffix = e2eId();

  test.afterAll(async () => {
    await cleanupE2eRecords();
  });

  test('filtering by branch narrows the report to that branch', async ({ page }) => {
    const branchA = await prisma.branch.create({ data: { name: `e2e-BranchA-${suffix}` } });
    const branchB = await prisma.branch.create({ data: { name: `e2e-BranchB-${suffix}` } });

    async function emp(tag: string, branchId: string) {
      const user = await prisma.user.create({ data: {} });
      return prisma.employee.create({
        data: {
          userId: user.id,
          firstName: `e2e-${tag}`,
          lastName: `e2e-${suffix}`,
          branchId,
          salaryType: 'Monthly',
          baseSalary: new Prisma.Decimal(20_000),
          status: 'Active',
          canCheckIn: true,
          hiredAt: new Date('2026-01-01'),
        },
      });
    }
    await emp('Alice', branchA.id);
    await emp('Bob', branchB.id);

    await loginAsAdmin(page);

    // Unfiltered: both employees appear.
    await page.goto('/admin/reports/attendance');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toContainText(`e2e-Alice e2e-${suffix}`);
    await expect(page.locator('body')).toContainText(`e2e-Bob e2e-${suffix}`);

    // Filtered to branch A: only Alice.
    await page.goto(`/admin/reports/attendance?branchId=${branchA.id}`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toContainText(`e2e-Alice e2e-${suffix}`);
    await expect(page.locator('body')).not.toContainText(`e2e-Bob e2e-${suffix}`);
  });
});
