import { expect, test } from '@playwright/test';
import { Prisma } from '@prisma/client';
import { restoreLeaveRequest, voidLeaveRequest } from '@/lib/leave/void';
import { cleanupE2eRecords, e2eId, prisma } from './helpers/db';

/**
 * DEFERRED SUITE — same session seam as admin-attendance-void.spec.ts.
 * Verifies the leave cascade: voiding an approved leave also voids its
 * generated Attendance(OnLeave) rows; restore brings both back.
 */
test.describe('voidLeaveRequest cascade', () => {
  test.afterAll(async () => {
    await cleanupE2eRecords();
  });

  test('voiding approved leave also voids its OnLeave attendance; restore brings both back', async () => {
    const s = e2eId();
    const branch = await prisma.branch.create({ data: { name: `e2e-Branch-${s}` } });
    const u = await prisma.user.create({ data: {} });
    const emp = await prisma.employee.create({
      data: {
        userId: u.id,
        firstName: `e2e-${s}`,
        lastName: 'L',
        branchId: branch.id,
        assignedBranchIds: [branch.id],
        salaryType: 'Monthly',
        baseSalary: new Prisma.Decimal(20_000),
        status: 'Active',
        canCheckIn: true,
        hiredAt: new Date('2026-01-01'),
      },
    });
    const lt = await prisma.leaveType.create({ data: { name: `e2e-LT-${s}`, isPaid: true } });
    const leave = await prisma.leaveRequest.create({
      data: {
        employeeId: emp.id,
        leaveTypeId: lt.id,
        startDate: new Date('2026-05-25'),
        endDate: new Date('2026-05-25'),
        reason: 'x',
        status: 'Approved',
      },
    });
    await prisma.attendance.create({
      data: {
        employeeId: emp.id,
        date: new Date('2026-05-25'),
        type: 'OnLeave',
        source: 'Manual',
        leaveRequestId: leave.id,
        createdById: u.id,
      },
    });

    const v = await voidLeaveRequest(leave.id, 'อนุมัติผิดคน');
    expect(v.ok).toBe(true);

    // Default (extended) client must not see the leave nor its OnLeave attendance.
    expect(
      await prisma.leaveRequest.findFirst({ where: { id: leave.id, deletedAt: null } }),
    ).toBeNull();
    const liveOnLeave = await prisma.attendance.findMany({
      where: { leaveRequestId: leave.id, deletedAt: null },
    });
    expect(liveOnLeave).toHaveLength(0);

    const r = await restoreLeaveRequest(leave.id);
    expect(r.ok).toBe(true);
    const back = await prisma.attendance.findMany({
      where: { leaveRequestId: leave.id, deletedAt: null },
    });
    expect(back).toHaveLength(1);
  });
});
