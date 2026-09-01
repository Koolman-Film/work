/**
 * `loadPendingCounts` — the shared source of truth behind BOTH the admin
 * sidebar badges and the 08:30 admin daily digest.
 *
 * Written while investigating "admin notification ไม่เข้า": in production the
 * digest ran to completion on 2026-09-01 but its `pending-counts-<adminId>`
 * step returned `{leave: 0, advance: 0, attendance: 0}` for a GLOBAL
 * superadmin, while four leave requests sat Pending. Zero counts make
 * `shouldSendDigest` false, so no digest is ever sent.
 *
 * This file had no test at all before. These cases pin the behaviour the
 * digest depends on, starting with the exact production shape: an admin whose
 * role assignments are global (branchId = null).
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getUserAssignments } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { loadPendingCounts } from '@/lib/notifications/pending-counts';

async function reset() {
  await prisma.leaveRequest.deleteMany({});
  await prisma.cashAdvance.deleteMany({});
  await prisma.attendance.deleteMany({});
  await prisma.leaveType.deleteMany({});
  await prisma.userRoleAssignment.deleteMany({});
  await prisma.roleDefinition.deleteMany({});
  await prisma.employee.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.branch.deleteMany({});
}
afterAll(async () => {
  await prisma.$disconnect();
});

/** A role carrying the three read permissions the counts are scoped by. */
async function adminRole(key: string, isSuperadmin = false) {
  return prisma.roleDefinition.create({
    data: {
      key,
      name: key,
      isSuperadmin,
      permissions: isSuperadmin ? [] : ['leave.read', 'advance.read', 'attendance.read'],
    },
  });
}

async function employeeIn(branchId: string, firstName: string) {
  const user = await prisma.user.create({ data: {} });
  return prisma.employee.create({
    data: {
      userId: user.id,
      firstName,
      lastName: 'ทดสอบ',
      branchId,
      salaryType: 'Monthly',
      baseSalary: 20000,
      status: 'Active',
      hiredAt: new Date('2026-01-01'),
    },
  });
}

async function pendingLeave(employeeId: string, leaveTypeId: string) {
  return prisma.leaveRequest.create({
    data: {
      employeeId,
      leaveTypeId,
      startDate: new Date('2026-08-07'),
      endDate: new Date('2026-08-07'),
      unit: 'FullDay',
      reason: 'x',
      status: 'Pending',
    },
  });
}

beforeEach(reset);

describe('loadPendingCounts — branch scoping', () => {
  it('a GLOBAL superadmin (branchId = null) sees pending work in every branch', async () => {
    const branch = await prisma.branch.create({ data: { name: 'เชียงใหม่' } });
    const lt = await prisma.leaveType.create({ data: { name: 'ลาป่วย', isPaid: true } });
    const emp = await employeeIn(branch.id, 'ก');
    await pendingLeave(emp.id, lt.id);

    const admin = await prisma.user.create({ data: { email: 'super@x.test' } });
    const role = await adminRole('superadmin', true);
    await prisma.userRoleAssignment.create({
      data: { userId: admin.id, roleId: role.id, branchId: null }, // global, as in production
    });

    const counts = await loadPendingCounts(await getUserAssignments(admin.id));
    expect(counts.leave).toBe(1);
  });

  it('a GLOBAL non-superadmin admin holding leave.read also sees every branch', async () => {
    const branch = await prisma.branch.create({ data: { name: 'เชียงใหม่' } });
    const lt = await prisma.leaveType.create({ data: { name: 'ลาป่วย', isPaid: true } });
    const emp = await employeeIn(branch.id, 'ข');
    await pendingLeave(emp.id, lt.id);

    const admin = await prisma.user.create({ data: { email: 'admin@x.test' } });
    const role = await adminRole('admin');
    await prisma.userRoleAssignment.create({
      data: { userId: admin.id, roleId: role.id, branchId: null },
    });

    const counts = await loadPendingCounts(await getUserAssignments(admin.id));
    expect(counts.leave).toBe(1);
  });

  it('an admin with NO assignments sees nothing (empty scope means nowhere, not everywhere)', async () => {
    const branch = await prisma.branch.create({ data: { name: 'เชียงใหม่' } });
    const lt = await prisma.leaveType.create({ data: { name: 'ลาป่วย', isPaid: true } });
    const emp = await employeeIn(branch.id, 'ค');
    await pendingLeave(emp.id, lt.id);

    const stranger = await prisma.user.create({ data: { email: 'nobody@x.test' } });
    const counts = await loadPendingCounts(await getUserAssignments(stranger.id));
    expect(counts.leave).toBe(0);
  });

  it('SOFT-DELETED pending requests are not counted', async () => {
    // The `prisma` client carries softDeleteExtension, so `deletedAt` rows are
    // invisible to every read. Worth pinning: raw SQL against this table shows
    // status='Pending' rows that the app correctly ignores, and mistaking those
    // for real pending work sends you hunting a bug that isn't there. That is
    // exactly what happened while investigating the digest on 2026-09-01 — all
    // four "pending" leave requests in production were soft-deleted.
    const branch = await prisma.branch.create({ data: { name: 'เชียงใหม่' } });
    const lt = await prisma.leaveType.create({ data: { name: 'ลาป่วย', isPaid: true } });
    const emp = await employeeIn(branch.id, 'ฉ');
    const live = await pendingLeave(emp.id, lt.id);
    const gone = await pendingLeave(emp.id, lt.id);
    await prisma.leaveRequest.update({
      where: { id: gone.id },
      data: { deletedAt: new Date(), deleteReason: 'ลาผิดประเภท' },
    });

    const admin = await prisma.user.create({ data: { email: 'soft@x.test' } });
    const role = await adminRole('superadmin', true);
    await prisma.userRoleAssignment.create({
      data: { userId: admin.id, roleId: role.id, branchId: null },
    });

    const counts = await loadPendingCounts(await getUserAssignments(admin.id));
    expect(counts.leave).toBe(1); // only `live`, not `gone`
    expect(live.id).not.toBe(gone.id);
  });

  it('a BRANCH-SCOPED admin sees only their own branch', async () => {
    const mine = await prisma.branch.create({ data: { name: 'เชียงใหม่' } });
    const other = await prisma.branch.create({ data: { name: 'กรุงเทพ' } });
    const lt = await prisma.leaveType.create({ data: { name: 'ลาป่วย', isPaid: true } });
    await pendingLeave((await employeeIn(mine.id, 'ง')).id, lt.id);
    await pendingLeave((await employeeIn(other.id, 'จ')).id, lt.id);

    const admin = await prisma.user.create({ data: { email: 'branch@x.test' } });
    const role = await adminRole('branch-admin');
    await prisma.userRoleAssignment.create({
      data: { userId: admin.id, roleId: role.id, branchId: mine.id },
    });

    const counts = await loadPendingCounts(await getUserAssignments(admin.id));
    expect(counts.leave).toBe(1);
  });
});
