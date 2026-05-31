import { expect, test } from '@playwright/test';
import { Prisma } from '@prisma/client';
import { cleanupE2eRecords, e2eId, prisma } from './helpers/db';

test.describe('Soft-delete read-path semantics', () => {
  test.afterAll(async () => {
    await cleanupE2eRecords();
  });

  async function seedEmployee(suffix: string) {
    const branch = await prisma.branch.create({ data: { name: `e2e-Branch-${suffix}` } });
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
    return { employee, user, branch };
  }

  test('partial unique index frees the slot after void', async () => {
    const s = e2eId();
    const { employee, user } = await seedEmployee(s);
    const date = new Date('2026-05-20');

    const first = await prisma.attendance.create({
      data: { employeeId: employee.id, date, type: 'Late', source: 'Manual', createdById: user.id },
    });

    await expect(
      prisma.attendance.create({
        data: {
          employeeId: employee.id,
          date,
          type: 'Late',
          source: 'Manual',
          createdById: user.id,
        },
      }),
    ).rejects.toThrow();

    await prisma.attendance.update({ where: { id: first.id }, data: { deletedAt: new Date() } });

    const second = await prisma.attendance.create({
      data: { employeeId: employee.id, date, type: 'Late', source: 'Manual', createdById: user.id },
    });
    expect(second.id).not.toBe(first.id);
  });
});
