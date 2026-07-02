import { Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const link = vi.fn();
const unlink = vi.fn();
vi.mock('@/lib/line/messaging-client', () => ({
  getLineMessagingClient: () => ({
    linkRichMenuIdToUser: link,
    unlinkRichMenuIdFromUser: unlink,
  }),
}));

import { prisma } from '@/lib/db/prisma';
import { syncRichMenuForUser } from '@/lib/line/rich-menu';

process.env.ADMIN_RICH_MENU_ID = 'rm-admin';
process.env.COMBINED_RICH_MENU_ID = 'rm-combined';
process.env.EMPLOYEE_RICH_MENU_ID = 'rm-employee';

// Branch id shared across tests — created once in reset()
let branchId: string;

async function reset() {
  // Safe FK delete order: children before parents
  await prisma.attendance.deleteMany({});
  await prisma.userRoleAssignment.deleteMany({});
  await prisma.payroll.deleteMany({});
  await prisma.overtimeEntry.deleteMany({});
  await prisma.cashAdvance.deleteMany({});
  await prisma.recurringDeduction.deleteMany({});
  await prisma.leaveRequest.deleteMany({});
  await prisma.employee.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.roleDefinition.deleteMany({});
  await prisma.branch.deleteMany({});
  const branch = await prisma.branch.create({ data: { name: 'Test Branch' } });
  branchId = branch.id;
}
beforeEach(async () => {
  link.mockClear();
  unlink.mockClear();
  await reset();
});
afterAll(async () => {
  await prisma.$disconnect();
});

async function adminRole() {
  return prisma.roleDefinition.create({
    data: { key: 'admin', name: 'Admin', isSuperadmin: false, isSystem: true },
  });
}

describe('syncRichMenuForUser', () => {
  it('admin + employee → links the combined menu', async () => {
    const role = await adminRole();
    const user = await prisma.user.create({ data: { lineUserId: 'U-both' } });
    await prisma.employee.create({
      data: {
        userId: user.id,
        firstName: 'A',
        lastName: 'B',
        branchId,
        salaryType: 'Monthly',
        baseSalary: new Prisma.Decimal(1),
        status: 'Active',
        hiredAt: new Date('2026-01-01'),
      },
    });
    await prisma.userRoleAssignment.create({ data: { userId: user.id, roleId: role.id } });

    await syncRichMenuForUser(user.id);
    expect(link).toHaveBeenCalledWith('U-both', 'rm-combined');
  });

  it('pure admin → links the admin menu', async () => {
    const role = await adminRole();
    const user = await prisma.user.create({ data: { lineUserId: 'U-admin' } });
    await prisma.userRoleAssignment.create({ data: { userId: user.id, roleId: role.id } });

    await syncRichMenuForUser(user.id);
    expect(link).toHaveBeenCalledWith('U-admin', 'rm-admin');
  });

  it('employee only → links the employee menu (all-dynamic)', async () => {
    const user = await prisma.user.create({ data: { lineUserId: 'U-emp' } });
    await prisma.employee.create({
      data: {
        userId: user.id,
        firstName: 'A',
        lastName: 'B',
        branchId,
        salaryType: 'Monthly',
        baseSalary: new Prisma.Decimal(1),
        status: 'Active',
        hiredAt: new Date('2026-01-01'),
      },
    });

    await syncRichMenuForUser(user.id);
    expect(link).toHaveBeenCalledWith('U-emp', 'rm-employee');
  });

  it('archived User → unlinks even with an admin role', async () => {
    const role = await adminRole();
    const user = await prisma.user.create({
      data: { lineUserId: 'U-arch', archivedAt: new Date() },
    });
    await prisma.userRoleAssignment.create({ data: { userId: user.id, roleId: role.id } });

    await syncRichMenuForUser(user.id);
    expect(unlink).toHaveBeenCalledWith('U-arch');
    expect(link).not.toHaveBeenCalled();
  });

  it('archived Employee (staff only) → unlinks', async () => {
    const user = await prisma.user.create({ data: { lineUserId: 'U-emp-arch' } });
    await prisma.employee.create({
      data: {
        userId: user.id,
        firstName: 'A',
        lastName: 'B',
        branchId,
        salaryType: 'Monthly',
        baseSalary: new Prisma.Decimal(1),
        status: 'Archived',
        archivedAt: new Date(),
        hiredAt: new Date('2026-01-01'),
      },
    });

    await syncRichMenuForUser(user.id);
    expect(unlink).toHaveBeenCalledWith('U-emp-arch');
    expect(link).not.toHaveBeenCalled();
  });

  it('no lineUserId → no-op', async () => {
    const user = await prisma.user.create({ data: {} });
    await syncRichMenuForUser(user.id);
    expect(link).not.toHaveBeenCalled();
    expect(unlink).not.toHaveBeenCalled();
  });
});
