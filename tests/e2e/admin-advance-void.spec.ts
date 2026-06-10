import { expect, test } from '@playwright/test';
import { Prisma } from '@prisma/client';
import { voidCashAdvance } from '@/lib/advance/void';
import { cleanupE2eRecords, e2eId, prisma } from './helpers/db';

/**
 * DEFERRED SUITE — same session seam as admin-attendance-void.spec.ts.
 * Verifies the isDeducted block: a non-deducted advance voids; a deducted one
 * is refused with code 'already-deducted'.
 */
test.describe('voidCashAdvance', () => {
  // Deferred until the session seam exists (see header) — direct server-action
  // calls throw `cookies() outside a request scope` under the Playwright runner.
  test.fixme(true, 'deferred: needs session-injection helper for server actions');

  test.afterAll(async () => {
    await cleanupE2eRecords();
  });

  async function seedAdvance(s: string, isDeducted: boolean) {
    const branch = await prisma.branch.create({ data: { name: `e2e-Branch-${s}` } });
    const u = await prisma.user.create({ data: {} });
    const emp = await prisma.employee.create({
      data: {
        userId: u.id,
        firstName: `e2e-${s}`,
        lastName: 'A',
        branchId: branch.id,
        assignedBranchIds: [branch.id],
        salaryType: 'Monthly',
        baseSalary: new Prisma.Decimal(20_000),
        status: 'Active',
        canCheckIn: true,
        hiredAt: new Date('2026-01-01'),
      },
    });
    return prisma.cashAdvance.create({
      data: {
        employeeId: emp.id,
        amount: new Prisma.Decimal(2000),
        status: 'Approved',
        isDeducted,
      },
    });
  }

  test('voids a non-deducted advance', async () => {
    const adv = await seedAdvance(e2eId(), false);
    const v = await voidCashAdvance(adv.id, 'อนุมัติผิด');
    expect(v.ok).toBe(true);
    expect(
      await prisma.cashAdvance.findFirst({ where: { id: adv.id, deletedAt: null } }),
    ).toBeNull();
  });

  test('refuses to void a deducted advance', async () => {
    const adv = await seedAdvance(e2eId(), true);
    const v = await voidCashAdvance(adv.id, 'อนุมัติผิด');
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe('already-deducted');
  });
});
