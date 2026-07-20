/**
 * Integration test for Defect 2: the reconcile actions must report success
 * even when the follow-up draft recalculation fails, since the settlement
 * itself has already committed by then.
 *
 * `setReconcileSettlement` / `clearReconcileSettlement` (payroll/reconcile/
 * actions.ts) commit the settlement via `setPenaltySettlement` /
 * `clearPenaltySettlement` (real — this is NOT a test of those guards, see
 * penalty-settlement.integration.test.ts for that), THEN call
 * `runPayrollDraft` in a SEPARATE transaction as a courtesy recalculation.
 * If that second call throws — now more likely in production, since it
 * contends on the month lock the settle just released — the action used to
 * let the whole thing reject, and reconcile-rows.tsx would tell the admin
 * the save failed when it hadn't: only the recalculation was lost. The fix
 * catches that second failure and still returns `{ ok: true }`, flagged
 * with `recalcPending: true` so the UI can say so honestly instead of lying
 * either way ("saved" would hide the stale draft; "failed" would be false).
 *
 * `runPayrollDraft` is partially mocked (import-actual + override) so this
 * test can force exactly that second-step failure without touching the
 * settlement-writing path at all.
 *
 * Mocks required because `setReconcileSettlement`/`clearReconcileSettlement`
 * are Next.js Server Actions:
 *   - `@/lib/auth/check-permission` → requirePermission / getUserAssignments:
 *     bypasses Supabase session; stubs a superadmin (global) grant so
 *     requireGlobalPermission('payroll.run') passes. Mirrors
 *     penalty-settlement.integration.test.ts.
 *   - `next/headers` → headers(): penalty-settlement-admin.ts reads
 *     IP/user-agent headers that don't exist outside a Next.js request.
 *   - `next/cache` → revalidatePath: no-op; there is no Next.js cache here.
 *   - `@/lib/payroll/run` → runPayrollDraft: overridden per-test via a
 *     shared `vi.fn`, defaulting to the REAL implementation (via
 *     `importOriginal`) so tests that don't care about this behave exactly
 *     like production.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db/prisma';

const adminUserHolder: { id: string } = { id: '00000000-0000-0000-0000-000000000000' };

vi.mock('@/lib/auth/check-permission', () => ({
  requirePermission: vi.fn(async () => ({
    user: adminUserHolder,
    authUserId: adminUserHolder.id,
    tier: 'Admin',
  })),
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

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => ({
    get: (_name: string) => null,
  })),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

// `vi.mock` factories are hoisted to the top of the file — `runPayrollDraftMock`
// must be created through `vi.hoisted` so it exists by the time the factory
// below runs, rather than as a plain top-level `const` (which would still be
// in its TDZ at that point).
const { runPayrollDraftMock } = vi.hoisted(() => ({ runPayrollDraftMock: vi.fn() }));
vi.mock('@/lib/payroll/run', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/payroll/run')>();
  // Default: delegate to the REAL implementation, so any test that doesn't
  // explicitly override this (via `.mockRejectedValueOnce`) behaves exactly
  // like production. Set once here (not in beforeEach) so per-test
  // `.mockRejectedValueOnce` overrides fall back to this afterward instead of
  // to a cleared no-op.
  runPayrollDraftMock.mockImplementation((month: string) => actual.runPayrollDraft(month));
  return { ...actual, runPayrollDraft: runPayrollDraftMock };
});

import { Prisma } from '@prisma/client';
// Import AFTER vi.mock hoisting.
import {
  clearReconcileSettlement,
  setReconcileSettlement,
} from '@/app/(admin)/admin/payroll/reconcile/actions';

function uid(): string {
  return crypto.randomUUID();
}

async function reset() {
  await prisma.attendancePenaltySettlement.deleteMany({});
  await prisma.payroll.deleteMany({});
  await prisma.attendance.deleteMany({});
  await prisma.leaveRequest.deleteMany({});
  await prisma.leaveEntitlement.deleteMany({});
  await prisma.employee.deleteMany({});
  await prisma.userRoleAssignment.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.leaveType.deleteMany({});
  await prisma.branch.deleteMany({});
  await prisma.payrollConfig.deleteMany({});
  await prisma.leaveConfig.deleteMany({});

  await prisma.payrollConfig.create({
    data: {
      ssoRate: new Prisma.Decimal('0.05'),
      ssoSalaryCap: new Prisma.Decimal(15_000),
      ssoAmountCap: new Prisma.Decimal(750),
      otMultiplier: new Prisma.Decimal('1.5'),
      absentDeductionPerDay: new Prisma.Decimal(500),
      lateDeduction: new Prisma.Decimal(100),
      earlyLeaveDeduction: new Prisma.Decimal(100),
    },
  });
  await prisma.leaveConfig.create({ data: {} });

  const adminUser = await prisma.user.create({ data: {} });
  adminUserHolder.id = adminUser.id;

  // Clear call history only — keep the default real-implementation fallback
  // set up in the vi.mock factory above.
  runPayrollDraftMock.mockClear();
}

async function makeEmployee() {
  const user = await prisma.user.create({ data: {} });
  const branch = await prisma.branch.create({ data: { name: `Branch-${uid().slice(0, 8)}` } });
  return prisma.employee.create({
    data: {
      userId: user.id,
      firstName: 'Test',
      lastName: 'Worker',
      branchId: branch.id,
      salaryType: 'Monthly',
      baseSalary: new Prisma.Decimal(20_000),
      status: 'Active',
      hiredAt: new Date('2026-01-01'),
    },
  });
}

async function makeAbsence(employeeId: string, date = '2026-07-01') {
  await prisma.attendance.create({
    data: {
      employeeId,
      date: new Date(date),
      type: 'Absent',
      source: 'Manual',
      createdById: uid(),
    },
  });
}

async function makeVacationType() {
  return prisma.leaveType.create({
    data: {
      name: `ลาพักร้อน-${uid().slice(0, 8)}`,
      annualQuota: 10,
      penaltySettlementAllowed: true,
    },
  });
}

beforeEach(reset);
afterAll(async () => {
  await prisma.$disconnect();
});

describe('setReconcileSettlement — recalculation-pending contract (Defect 2)', () => {
  it('reports plain success when the recalculation also succeeds', async () => {
    const emp = await makeEmployee();
    const vacation = await makeVacationType();
    await makeAbsence(emp.id);

    const result = await setReconcileSettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 1,
    });

    expect(result).toEqual({ ok: true });
    expect(runPayrollDraftMock).toHaveBeenCalledWith('2026-07');
  });

  it('still reports success, flagged recalcPending, when the settlement commits but the recalculation throws', async () => {
    const emp = await makeEmployee();
    const vacation = await makeVacationType();
    await makeAbsence(emp.id);
    runPayrollDraftMock.mockRejectedValueOnce(new Error('P2028: transaction timeout'));

    const result = await setReconcileSettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 1,
    });

    expect(result).toEqual({ ok: true, recalcPending: true });

    // The settlement itself is committed — this is the whole point of the
    // fix: a lost recalculation must never look like a lost save.
    const row = await prisma.attendancePenaltySettlement.findUniqueOrThrow({
      where: { employeeId_month_kind: { employeeId: emp.id, month: '2026-07', kind: 'Absent' } },
    });
    expect(row.days.toNumber()).toBe(1);
    expect(row.deletedAt).toBeNull();
  });

  it('does not call runPayrollDraft, and never reports recalcPending, when the settlement itself is refused', async () => {
    const emp = await makeEmployee();
    const vacation = await makeVacationType(); // no actual Absent day this month

    const result = await setReconcileSettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 1,
    });

    // No actual Absent day this month → refused by the exceeds-penalty guard,
    // never reaching the recalculation step at all.
    expect(result).toEqual({ ok: false, error: 'exceeds-penalty' });
    expect(runPayrollDraftMock).not.toHaveBeenCalled();
  });
});

describe('clearReconcileSettlement — recalculation-pending contract (Defect 2)', () => {
  it('still reports success, flagged recalcPending, when the clear commits but the recalculation throws', async () => {
    const emp = await makeEmployee();
    const vacation = await makeVacationType();
    await makeAbsence(emp.id);

    const settled = await setReconcileSettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
      leaveTypeId: vacation.id,
      days: 1,
    });
    expect(settled).toEqual({ ok: true });

    runPayrollDraftMock.mockRejectedValueOnce(new Error('P2028: transaction timeout'));

    const result = await clearReconcileSettlement({
      employeeId: emp.id,
      month: '2026-07',
      kind: 'Absent',
    });

    expect(result).toEqual({ ok: true, recalcPending: true });

    const row = await prisma.attendancePenaltySettlement.findUniqueOrThrow({
      where: { employeeId_month_kind: { employeeId: emp.id, month: '2026-07', kind: 'Absent' } },
    });
    expect(row.deletedAt).not.toBeNull();
  });
});
