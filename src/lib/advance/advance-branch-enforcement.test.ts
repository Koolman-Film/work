/**
 * Branch-scope enforcement for advance mutations (Spec B4).
 *
 * Mocks only boundaries; drives the REAL getPermittedBranches /
 * canActOnEmployeeBranches by mocking getUserAssignments at the seam.
 * Mock shape mirrors src/lib/advance/mark-paid.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({ headers: vi.fn(async () => ({ get: () => null })) }));
vi.mock('@/lib/audit/log', () => ({ auditLog: vi.fn(), auditLogTx: vi.fn(async () => undefined) }));
vi.mock('@/lib/inngest/events', () => ({ sendNotification: vi.fn(async () => undefined) }));
vi.mock('@/lib/notifications/admin-line', () => ({
  notifyAdminsOnLine: vi.fn(async () => undefined),
}));
vi.mock('@/lib/notifications/in-app-bell', () => ({
  notifyAdminsInApp: vi.fn(async () => undefined),
}));

// advanceBalanceFor / isOverCap drive approve's cap pre-check. Default: in-cap.
const advanceBalanceFor = vi.fn(async () => ({ available: 999999 }));
vi.mock('@/lib/advance/available', () => ({
  advanceBalanceFor: (...a: Parameters<typeof advanceBalanceFor>) => advanceBalanceFor(...a),
}));
vi.mock('@/lib/advance/balance', () => ({ isOverCap: vi.fn(() => false) }));

// auth seam — REAL branch-scope, only getUserAssignments mocked.
const requirePermission = vi.fn();
const getUserAssignments = vi.fn();
vi.mock('@/lib/auth/check-permission', () => ({
  requirePermission: (...a: unknown[]) => requirePermission(...a),
  getUserAssignments: (...a: unknown[]) => getUserAssignments(...a),
  canDo: vi.fn(),
}));

// prisma seam: outer client (capRow / employee / pending) + a tx stub.
const caFindUnique = vi.fn(); // prisma.cashAdvance.findUnique (capRow, outside tx)
const caFindFirst = vi.fn(); // prisma.cashAdvance.findFirst (pending check)
const caCreate = vi.fn(async () => ({ id: 'ca-new' }));
const empFindUnique = vi.fn(); // prisma.employee.findUnique (adminCreate)
const txFindUnique = vi.fn(); // tx.cashAdvance.findUnique
const txUpdate = vi.fn(async () => ({}));
const txCreate = vi.fn(async () => ({ id: 'ca-new' }));
const transactionFn = vi.fn(async (fn: (tx: unknown) => unknown) =>
  fn({ cashAdvance: { findUnique: txFindUnique, update: txUpdate, create: txCreate } }),
);
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    $transaction: (fn: (tx: unknown) => unknown) => transactionFn(fn),
    cashAdvance: {
      findUnique: (...a: unknown[]) => caFindUnique(...a),
      findFirst: (...a: unknown[]) => caFindFirst(...a),
      create: (...a: Parameters<typeof caCreate>) => caCreate(...a),
    },
    employee: { findUnique: (...a: unknown[]) => empFindUnique(...a) },
  },
  prismaRaw: { cashAdvance: { findUnique: (...a: unknown[]) => caFindUnique(...a) } },
}));

import {
  adminCreateCashAdvance,
  approveCashAdvance,
  markAdvancePaid,
  rejectCashAdvance,
} from './admin';

// helpers
const BRANCH_A = '00000000-0000-0000-0000-00000000000a';
const BRANCH_B = '00000000-0000-0000-0000-00000000000b';
function scopedTo(branchId: string, perm: string) {
  return [{ branchId, role: { permissions: [perm], isSuperadmin: false, archivedAt: null } }];
}
function globalGrant(perm: string) {
  return [{ branchId: null, role: { permissions: [perm], isSuperadmin: false, archivedAt: null } }];
}
/** A loaded advance row whose employee lives in `home` (+ optional assigned). */
function advRow(home: string, assigned: string[] = [], over: Record<string, unknown> = {}) {
  return {
    id: 'ca1',
    status: 'Pending',
    amount: '1000',
    employeeId: 'e1',
    paidAt: null,
    receiptUrl: null,
    isDeducted: false,
    employee: { firstName: 'ก', userId: 'u1', branchId: home, assignedBranchIds: assigned },
    ...over,
  };
}

describe('approveCashAdvance — branch act-on gate (capRow)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({ user: { id: 'actor' }, authUserId: 'auth-1' });
    advanceBalanceFor.mockResolvedValue({ available: 999999 });
  });

  it('scoped actor on out-of-scope advance → not-found, cap check NOT run', async () => {
    getUserAssignments.mockResolvedValue(scopedTo(BRANCH_A, 'advance.approve'));
    caFindUnique.mockResolvedValue(advRow(BRANCH_B)); // capRow out of scope
    const res = await approveCashAdvance({ cashAdvanceId: 'ca1' });
    expect(res).toMatchObject({ ok: false, code: 'not-found' });
    expect(advanceBalanceFor).not.toHaveBeenCalled(); // gate fired before the cap check
    expect(transactionFn).not.toHaveBeenCalled();
  });

  it('scoped actor on in-scope advance → passes the gate (cap check runs)', async () => {
    getUserAssignments.mockResolvedValue(scopedTo(BRANCH_A, 'advance.approve'));
    caFindUnique.mockResolvedValue(advRow(BRANCH_A));
    txFindUnique.mockResolvedValue(advRow(BRANCH_A));
    await approveCashAdvance({ cashAdvanceId: 'ca1' });
    expect(advanceBalanceFor).toHaveBeenCalled(); // got past the gate
  });

  it('global actor on out-of-branch advance → passes the gate', async () => {
    getUserAssignments.mockResolvedValue(globalGrant('advance.approve'));
    caFindUnique.mockResolvedValue(advRow(BRANCH_B));
    txFindUnique.mockResolvedValue(advRow(BRANCH_B));
    await approveCashAdvance({ cashAdvanceId: 'ca1' });
    expect(advanceBalanceFor).toHaveBeenCalled();
  });
});

describe('rejectCashAdvance — branch act-on gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({ user: { id: 'actor' }, authUserId: 'auth-1' });
  });

  it('scoped actor on out-of-scope advance → not-found, no update', async () => {
    getUserAssignments.mockResolvedValue(scopedTo(BRANCH_A, 'advance.approve'));
    txFindUnique.mockResolvedValue(advRow(BRANCH_B));
    const res = await rejectCashAdvance({ cashAdvanceId: 'ca1' });
    expect(res).toMatchObject({ ok: false, code: 'not-found' });
    expect(txUpdate).not.toHaveBeenCalled();
  });

  it('scoped actor on in-scope advance → updates', async () => {
    getUserAssignments.mockResolvedValue(scopedTo(BRANCH_A, 'advance.approve'));
    txFindUnique.mockResolvedValue(advRow(BRANCH_A));
    const res = await rejectCashAdvance({ cashAdvanceId: 'ca1' });
    expect(res).toMatchObject({ ok: true });
    expect(txUpdate).toHaveBeenCalled();
  });

  it('global actor on out-of-branch advance → updates', async () => {
    getUserAssignments.mockResolvedValue(globalGrant('advance.approve'));
    txFindUnique.mockResolvedValue(advRow(BRANCH_B));
    const res = await rejectCashAdvance({ cashAdvanceId: 'ca1' });
    expect(res).toMatchObject({ ok: true });
    expect(txUpdate).toHaveBeenCalled();
  });
});

describe('markAdvancePaid — branch act-on gate (financial)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({ user: { id: 'actor' }, authUserId: 'auth-1' });
  });
  const paidInput = { cashAdvanceId: 'ca1', receiptKey: 'auth-1/advance-receipts/x.jpg' };

  it('scoped actor on out-of-scope advance → not-found, no slip write', async () => {
    getUserAssignments.mockResolvedValue(scopedTo(BRANCH_A, 'advance.approve'));
    txFindUnique.mockResolvedValue(advRow(BRANCH_B, [], { status: 'Approved' }));
    const res = await markAdvancePaid(paidInput);
    expect(res).toMatchObject({ ok: false, code: 'not-found' });
    expect(txUpdate).not.toHaveBeenCalled();
  });

  it('scoped actor on in-scope advance → records payment', async () => {
    getUserAssignments.mockResolvedValue(scopedTo(BRANCH_A, 'advance.approve'));
    txFindUnique.mockResolvedValue(advRow(BRANCH_A, [], { status: 'Approved' }));
    const res = await markAdvancePaid(paidInput);
    expect(res).toMatchObject({ ok: true });
    expect(txUpdate).toHaveBeenCalled();
  });

  it('global actor on out-of-branch advance → records payment', async () => {
    getUserAssignments.mockResolvedValue(globalGrant('advance.approve'));
    txFindUnique.mockResolvedValue(advRow(BRANCH_B, [], { status: 'Approved' }));
    const res = await markAdvancePaid(paidInput);
    expect(res).toMatchObject({ ok: true });
    expect(txUpdate).toHaveBeenCalled();
  });
});

describe('adminCreateCashAdvance — branch act-on gate (on-behalf)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({ user: { id: 'actor' }, authUserId: 'auth-1' });
  });

  function emp(home: string, assigned: string[] = []) {
    return {
      id: 'e1',
      archivedAt: null,
      status: 'Active',
      firstName: 'ก',
      lastName: 'ข',
      nickname: null,
      branchId: home,
      assignedBranchIds: assigned,
    };
  }

  it('scoped actor choosing an out-of-scope employee → employee-not-found, no create', async () => {
    getUserAssignments.mockResolvedValue(scopedTo(BRANCH_A, 'advance.approve'));
    empFindUnique.mockResolvedValue(emp(BRANCH_B));
    const res = await adminCreateCashAdvance({ employeeId: 'e1', amount: 1000 });
    expect(res).toMatchObject({ ok: false, code: 'employee-not-found' });
    expect(caCreate).not.toHaveBeenCalled();
    expect(txCreate).not.toHaveBeenCalled();
  });

  it('scoped actor choosing an in-scope employee → passes the gate (reaches amount validation)', async () => {
    getUserAssignments.mockResolvedValue(scopedTo(BRANCH_A, 'advance.approve'));
    empFindUnique.mockResolvedValue(emp(BRANCH_A));
    // Bad amount → proves we got PAST the branch gate (gate returns employee-not-found).
    const res = await adminCreateCashAdvance({ employeeId: 'e1', amount: -5 });
    expect(res).toMatchObject({ ok: false, code: 'bad-amount' });
  });

  it('global actor choosing an out-of-branch employee → passes the gate (reaches amount validation)', async () => {
    getUserAssignments.mockResolvedValue(globalGrant('advance.approve'));
    empFindUnique.mockResolvedValue(emp(BRANCH_B));
    const res = await adminCreateCashAdvance({ employeeId: 'e1', amount: -5 });
    expect(res).toMatchObject({ ok: false, code: 'bad-amount' });
  });
});
