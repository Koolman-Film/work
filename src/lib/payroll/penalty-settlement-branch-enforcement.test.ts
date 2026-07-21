/**
 * B-payroll-guard Layer 1 enforcement for penalty settlement.
 *
 * Unlike advance/leave-branch-enforcement.test.ts (which pin a per-employee
 * "act on this branch's row" check), payroll permissions are GLOBAL-ONLY —
 * see permissions.ts's PAYROLL_PERMISSIONS comment. A settlement here
 * triggers `runPayrollDraft(month)`, which recomputes EVERY employee's
 * draft for the month, so there is no such thing as a branch-scoped actor
 * "in scope" for one settlement — a branch-scoped `payroll.run` holder must
 * be denied outright, every time, regardless of which employee/branch the
 * call names. That is what these tests pin.
 *
 * Mocks only boundaries; drives the REAL requireGlobalPermission →
 * getPermittedBranches → getUserAssignments chain by mocking
 * getUserAssignments at the seam, same technique as
 * advance-branch-enforcement.test.ts / leave-branch-enforcement.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => ({ get: () => null })) }));
vi.mock('@/lib/audit/log', () => ({ auditLogTx: vi.fn(async () => undefined) }));

// ── auth seam — REAL requireGlobalPermission/getPermittedBranches, only
//    getUserAssignments (and the requirePermission it wraps) mocked. ──────────
const requirePermission = vi.fn();
const getUserAssignments = vi.fn();
vi.mock('@/lib/auth/check-permission', () => ({
  requirePermission: (...a: unknown[]) => requirePermission(...a),
  getUserAssignments: (...a: unknown[]) => getUserAssignments(...a),
  canDo: vi.fn(),
}));

// ── leave/config seams — stubbed to a fixed 480 min/day standard day. ────────
const lockEntitlement = vi.fn();
const remainingByTypeForEmployee = vi.fn();
vi.mock('@/lib/leave/balance', () => ({
  lockEntitlement: (...a: unknown[]) => lockEntitlement(...a),
  remainingByTypeForEmployee: (...a: unknown[]) => remainingByTypeForEmployee(...a),
}));
vi.mock('@/lib/leave/leave-config', () => ({
  getLeaveConfig: vi.fn(async () => ({
    morningStart: '08:00',
    morningEnd: '12:00',
    afternoonStart: '13:00',
    afternoonEnd: '17:00',
  })),
}));

// ── payroll seams ─────────────────────────────────────────────────────────────
const lockPayrollMonth = vi.fn();
vi.mock('./month-lock', () => ({
  lockPayrollMonth: (...a: unknown[]) => lockPayrollMonth(...a),
  // Pass-through: this file's `lockPayrollMonth` mock always resolves `true`
  // (see beforeEach below), so the retry loop in the real implementation
  // would never actually run — a single call to `attempt()` is equivalent
  // and keeps this test from depending on the real retry timing/delays.
  withMonthLockRetry: (attempt: () => Promise<unknown>) => attempt(),
}));
const actualPenaltyDaysForEmployee = vi.fn();
vi.mock('./run', () => ({
  actualPenaltyDaysForEmployee: (...a: unknown[]) => actualPenaltyDaysForEmployee(...a),
}));

// ── prisma seam — outer client (getPenaltySettlement) + tx stub (writes). ────
const outerFindUnique = vi.fn(); // prisma.attendancePenaltySettlement.findUnique
const payrollFindFirst = vi.fn(); // tx.payroll.findFirst (isPeriodClosed)
const employeeFindUnique = vi.fn();
const leaveTypeFindUnique = vi.fn();
const settlementFindUnique = vi.fn(); // tx.attendancePenaltySettlement.findUnique
const settlementUpsert = vi.fn();
const settlementUpdateMany = vi.fn();

function txStub() {
  return {
    payroll: { findFirst: (...a: unknown[]) => payrollFindFirst(...a) },
    employee: { findUnique: (...a: unknown[]) => employeeFindUnique(...a) },
    leaveType: { findUnique: (...a: unknown[]) => leaveTypeFindUnique(...a) },
    attendancePenaltySettlement: {
      findUnique: (...a: unknown[]) => settlementFindUnique(...a),
      upsert: (...a: unknown[]) => settlementUpsert(...a),
      updateMany: (...a: unknown[]) => settlementUpdateMany(...a),
    },
  };
}
const transactionFn = vi.fn(async (fn: (tx: unknown) => unknown) => fn(txStub()));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    $transaction: (fn: (tx: unknown) => unknown) => transactionFn(fn),
    attendancePenaltySettlement: { findUnique: (...a: unknown[]) => outerFindUnique(...a) },
  },
}));

import {
  clearPenaltySettlement,
  getPenaltyLeaveBalance,
  getPenaltySettlement,
  setPenaltySettlement,
} from './penalty-settlement-admin';

const BRANCH_A = '00000000-0000-0000-0000-00000000000a';
const EMPLOYEE = '11111111-1111-1111-1111-111111111111';
const LEAVE_TYPE = '22222222-2222-2222-2222-222222222222';
const MONTH = '2026-07';

function scopedTo(branchId: string, perm: string) {
  return [{ branchId, role: { permissions: [perm], isSuperadmin: false, archivedAt: null } }];
}
function globalGrant(perm: string) {
  return [{ branchId: null, role: { permissions: [perm], isSuperadmin: false, archivedAt: null } }];
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue({ user: { id: 'actor' }, authUserId: 'a1', tier: 'Admin' });
  payrollFindFirst.mockResolvedValue(null);
  employeeFindUnique.mockResolvedValue({ salaryType: 'Monthly' });
  leaveTypeFindUnique.mockResolvedValue({ penaltySettlementAllowed: true, archivedAt: null });
  settlementFindUnique.mockResolvedValue(null);
  settlementUpsert.mockResolvedValue({ id: 'row-1' });
  settlementUpdateMany.mockResolvedValue({ count: 1 });
  remainingByTypeForEmployee.mockResolvedValue({ [LEAVE_TYPE]: 100000 });
  outerFindUnique.mockResolvedValue(null);
  lockEntitlement.mockResolvedValue(undefined);
  // `lockPayrollMonth` now returns whether it acquired the (non-blocking)
  // month lock (month-lock.ts) — `true` here mirrors every test in this
  // file expecting to proceed past that check, same as the old
  // void-returning mock implicitly did.
  lockPayrollMonth.mockResolvedValue(true);
  actualPenaltyDaysForEmployee.mockResolvedValue(null);
});

describe('setPenaltySettlement — global-only gate', () => {
  it('branch-scoped payroll.run holder → denied (notFound), no transaction, no audit', async () => {
    getUserAssignments.mockResolvedValue(scopedTo(BRANCH_A, 'payroll.run'));
    await expect(
      setPenaltySettlement({
        employeeId: EMPLOYEE,
        month: MONTH,
        kind: 'Absent',
        leaveTypeId: LEAVE_TYPE,
        days: 1,
        via: 'reconcile',
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(transactionFn).not.toHaveBeenCalled();
    expect(settlementUpsert).not.toHaveBeenCalled();
  });

  it('global payroll.run holder → passes the gate and settles', async () => {
    getUserAssignments.mockResolvedValue(globalGrant('payroll.run'));
    const res = await setPenaltySettlement({
      employeeId: EMPLOYEE,
      month: MONTH,
      kind: 'Absent',
      leaveTypeId: LEAVE_TYPE,
      days: 1,
      via: 'reconcile',
    });
    expect(res).toMatchObject({ ok: true });
    expect(settlementUpsert).toHaveBeenCalled();
  });
});

describe('clearPenaltySettlement — global-only gate', () => {
  it('branch-scoped payroll.run holder → denied (notFound), no transaction, no audit', async () => {
    getUserAssignments.mockResolvedValue(scopedTo(BRANCH_A, 'payroll.run'));
    await expect(
      clearPenaltySettlement({
        employeeId: EMPLOYEE,
        month: MONTH,
        kind: 'Absent',
        via: 'reconcile',
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(transactionFn).not.toHaveBeenCalled();
    expect(settlementUpdateMany).not.toHaveBeenCalled();
  });

  it('global payroll.run holder → passes the gate and clears', async () => {
    getUserAssignments.mockResolvedValue(globalGrant('payroll.run'));
    settlementFindUnique.mockResolvedValue({
      id: 'row-1',
      days: { toNumber: () => 1 },
      minutes: 480,
      leaveTypeId: LEAVE_TYPE,
      note: null,
    });
    const res = await clearPenaltySettlement({
      employeeId: EMPLOYEE,
      month: MONTH,
      kind: 'Absent',
      via: 'reconcile',
    });
    expect(res).toMatchObject({ ok: true });
    expect(settlementUpdateMany).toHaveBeenCalled();
  });
});

describe('getPenaltySettlement — global-only gate', () => {
  it('branch-scoped payroll.run holder → denied (notFound)', async () => {
    getUserAssignments.mockResolvedValue(scopedTo(BRANCH_A, 'payroll.run'));
    await expect(
      getPenaltySettlement({ employeeId: EMPLOYEE, month: MONTH, kind: 'Absent' }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(outerFindUnique).not.toHaveBeenCalled();
  });

  it('global payroll.run holder → passes the gate', async () => {
    getUserAssignments.mockResolvedValue(globalGrant('payroll.run'));
    const res = await getPenaltySettlement({ employeeId: EMPLOYEE, month: MONTH, kind: 'Absent' });
    expect(res).toBeNull();
    expect(outerFindUnique).toHaveBeenCalled();
  });
});

describe('getPenaltyLeaveBalance — global-only gate', () => {
  it('branch-scoped payroll.run holder → denied (notFound)', async () => {
    getUserAssignments.mockResolvedValue(scopedTo(BRANCH_A, 'payroll.run'));
    await expect(getPenaltyLeaveBalance({ employeeId: EMPLOYEE, month: MONTH })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    expect(remainingByTypeForEmployee).not.toHaveBeenCalled();
  });

  it('global payroll.run holder → passes the gate', async () => {
    getUserAssignments.mockResolvedValue(globalGrant('payroll.run'));
    const res = await getPenaltyLeaveBalance({ employeeId: EMPLOYEE, month: MONTH });
    expect(remainingByTypeForEmployee).toHaveBeenCalled();
    expect(res).toMatchObject({ [LEAVE_TYPE]: expect.any(Number) });
  });
});
