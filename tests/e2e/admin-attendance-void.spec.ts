import { expect, test } from '@playwright/test';
import { Prisma } from '@prisma/client';
import { restoreAttendance, voidAttendance } from '@/lib/attendance/void';
import { cleanupE2eRecords, e2eId, prisma } from './helpers/db';

/**
 * DEFERRED SUITE — see note. Exercises the voidAttendance / restoreAttendance
 * data contract: void frees the partial-unique slot; restore is refused once
 * the slot is re-filled.
 *
 * NOTE (session seam): these call the server actions directly, but
 * `requirePermission` inside them resolves a Supabase session from cookies.
 * A direct (non-browser) call has no session, so to RUN this suite you must
 * either (a) add a session-injecting test helper for server actions, or
 * (b) convert to a UI-driven spec (loginAsAdmin + click the void dialog wired
 * in the admin lists task). Until then this suite is part of the deferred e2e
 * set (local .env.local points at a dead DB anyway).
 */
test.describe('voidAttendance / restoreAttendance', () => {
  test.afterAll(async () => {
    await cleanupE2eRecords();
  });

  async function seedEmployee(s: string) {
    const branch = await prisma.branch.create({ data: { name: `e2e-Branch-${s}` } });
    const user = await prisma.user.create({ data: {} });
    const employee = await prisma.employee.create({
      data: {
        userId: user.id,
        firstName: `e2e-${s}`,
        lastName: 'V',
        branchId: branch.id,
        assignedBranchIds: [branch.id],
        salaryType: 'Monthly',
        baseSalary: new Prisma.Decimal(20_000),
        status: 'Active',
        canCheckIn: true,
        hiredAt: new Date('2026-01-01'),
      },
    });
    return { employee, user };
  }

  test('void frees the unique slot; restore is blocked if slot re-filled', async () => {
    const s = e2eId();
    const { employee, user } = await seedEmployee(s);
    const date = new Date('2026-05-21');

    const wrong = await prisma.attendance.create({
      data: { employeeId: employee.id, date, type: 'Late', source: 'Manual', createdById: user.id },
    });

    const v = await voidAttendance(wrong.id, 'ใส่ผิดวัน');
    expect(v.ok).toBe(true);

    // Slot is free — enter the correct row.
    const correct = await prisma.attendance.create({
      data: { employeeId: employee.id, date, type: 'Late', source: 'Manual', createdById: user.id },
    });
    expect(correct.id).not.toBe(wrong.id);

    // Restoring the wrong row must now fail (slot occupied).
    const r = await restoreAttendance(wrong.id);
    expect(r.ok).toBe(false);
  });
});
