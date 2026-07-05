/**
 * Integration test: the dispute-review reuse seam.
 *
 * The LIFF admin detail page (Tasks 1–3) wires to `approveDisputed` /
 * `rejectDisputed` from `@/lib/attendance/admin-review`. This test pins the
 * contract: approving or rejecting a Disputed check-in flips its
 * `checkInStatus` out of 'Disputed' (so it leaves the admin inbox).
 *
 * Mocks required because `admin-review.ts` is a Next.js Server Action:
 *   - `@/lib/auth/check-permission` → requirePermission: bypasses Supabase
 *     session; returns the seeded admin User so auditLogTx has a real actorId.
 *     Also getUserAssignments: review() branch-scope-gates via
 *     getPermittedBranches → getUserAssignments, so we stub it with a
 *     superadmin (global) grant → permitted = 'all', gate passes.
 *   - `next/headers` → headers(): the action reads IP / user-agent headers
 *     that don't exist outside a Next.js request context.
 *   - `@/lib/inngest/events` → sendNotification: fire-and-forget Inngest
 *     event; not exercised here (separate Inngest integration concern).
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db/prisma';

// ── Auth bypass ─────────────────────────────────────────────────────────────
// requirePermission is called before the DB write; we stub it to return the
// seeded admin user so auditLogTx gets a valid actorId without a Supabase
// session. The user.id placeholder is replaced in seedDisputed() below.
const adminUserHolder: { id: string } = { id: '00000000-0000-0000-0000-000000000000' };

vi.mock('@/lib/auth/check-permission', () => ({
  requirePermission: vi.fn(async () => ({
    user: adminUserHolder,
    authUserId: adminUserHolder.id,
    tier: 'Admin',
  })),
  // review() gates on getPermittedBranches(user, 'attendance.dispute-resolve'),
  // which reads getUserAssignments. A superadmin global grant → permitted 'all'.
  getUserAssignments: vi.fn(async () => [
    {
      branchId: null,
      role: {
        id: 'test-superadmin',
        key: 'superadmin',
        name: 'Superadmin',
        permissions: [],
        isSuperadmin: true,
        archivedAt: null,
      },
    },
  ]),
}));

// ── Next.js headers() stub ───────────────────────────────────────────────────
vi.mock('next/headers', () => ({
  headers: vi.fn(() => ({
    get: (_name: string) => null,
  })),
}));

// ── Inngest no-op ────────────────────────────────────────────────────────────
vi.mock('@/lib/inngest/events', () => ({
  sendNotification: vi.fn(async () => undefined),
}));

// Import AFTER vi.mock hoisting
import { approveDisputed, rejectDisputed } from '@/lib/attendance/admin-review';

// ── DB reset ─────────────────────────────────────────────────────────────────
// This DB is shared across integration files (fileParallelism: false), so a
// prior file's last-test rows persist. Delete every table that FKs Employee
// BEFORE employee.deleteMany, or the reset fails on a stray FK (e.g. a
// CashAdvance left by the advance-* reports tests). deleteMany on an empty
// table is a no-op, so listing the superset is safe and order-independent.
async function reset() {
  await prisma.auditLog.deleteMany({});
  await prisma.payrollAdjustment.deleteMany({});
  await prisma.payroll.deleteMany({});
  await prisma.recurringDeduction.deleteMany({});
  await prisma.overtimeEntry.deleteMany({});
  await prisma.attendance.deleteMany({});
  await prisma.cashAdvance.deleteMany({});
  await prisma.leaveRequest.deleteMany({});
  await prisma.leaveEntitlement.deleteMany({});
  await prisma.employee.deleteMany({});
  await prisma.userRoleAssignment.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.branch.deleteMany({});
}

beforeEach(reset);
afterAll(async () => {
  await prisma.$disconnect();
});

// ── Seed helper ───────────────────────────────────────────────────────────────
async function seedDisputed() {
  const branch = await prisma.branch.create({ data: { name: 'B' } });

  // Admin user — returned by the mocked requirePermission so auditLogTx has
  // a real actorId that satisfies the DB (no FK on AuditLog.actorId).
  const adminUser = await prisma.user.create({ data: {} });
  adminUserHolder.id = adminUser.id;

  // Employee user (the worker whose check-in is in dispute).
  const workerUser = await prisma.user.create({ data: {} });

  const emp = await prisma.employee.create({
    data: {
      userId: workerUser.id,
      firstName: 'A',
      lastName: 'B',
      branchId: branch.id,
      salaryType: 'Monthly',
      baseSalary: 20000,
      status: 'Active',
      hiredAt: new Date('2026-01-01'),
    },
  });

  return prisma.attendance.create({
    data: {
      employeeId: emp.id,
      date: new Date('2026-06-10'),
      type: 'CheckIn',
      source: 'Liff',
      clockInAt: new Date('2026-06-10T01:05:00Z'),
      checkInStatus: 'Disputed',
      disputeReason: 'นอกพื้นที่',
      createdById: workerUser.id,
    },
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('disputed check-in review (LIFF reuse seam)', () => {
  it('approve flips the check-in out of Disputed', async () => {
    const att = await seedDisputed();
    const res = await approveDisputed({ attendanceId: att.id, note: 'ตรวจสอบแล้ว ยืนยัน' });
    expect(res.ok).toBe(true);
    const after = await prisma.attendance.findUniqueOrThrow({ where: { id: att.id } });
    expect(after.checkInStatus).not.toBe('Disputed');
  });

  it('reject also resolves it (leaves the pending queue)', async () => {
    const att = await seedDisputed();
    const res = await rejectDisputed({ attendanceId: att.id, note: 'ไม่อนุมัติ เหตุผลไม่เพียงพอ' });
    expect(res.ok).toBe(true);
    const after = await prisma.attendance.findUniqueOrThrow({ where: { id: att.id } });
    expect(after.checkInStatus).not.toBe('Disputed');
  });
});
