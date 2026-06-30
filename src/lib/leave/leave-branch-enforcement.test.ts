/**
 * Branch-scope enforcement for leave mutations (Spec B3).
 *
 * Mocks only boundaries; drives the REAL getPermittedBranches /
 * canActOnEmployeeBranches by mocking getUserAssignments at the seam.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── next/* + infra mocks ──────────────────────────────────────────────────────
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Map()) }));
vi.mock('@/lib/audit/log', () => ({ auditLogTx: vi.fn() }));
vi.mock('@/lib/inngest/events', () => ({ sendNotification: vi.fn() })); // admin.ts imports sendNotification here
vi.mock('./leave-config', () => ({
  getLeaveConfig: vi.fn().mockResolvedValue({}),
}));

// ── auth seam ─────────────────────────────────────────────────────────────────
const requirePermission = vi.fn();
const getUserAssignments = vi.fn();
vi.mock('@/lib/auth/check-permission', () => ({
  requirePermission: (...a: unknown[]) => requirePermission(...a),
  getUserAssignments: (...a: unknown[]) => getUserAssignments(...a),
  canDo: vi.fn(),
}));

// ── prisma seam ───────────────────────────────────────────────────────────────
const lrFindUnique = vi.fn();
const lrUpdate = vi.fn();
const lrCreate = vi.fn();
const holidayFindMany = vi.fn();
const attFindMany = vi.fn();
const empFindUnique = vi.fn();
const transactionFn = vi.fn();

function txStub() {
  return {
    leaveRequest: {
      findUnique: (...a: unknown[]) => lrFindUnique(...a),
      update: (...a: unknown[]) => lrUpdate(...a),
      create: (...a: unknown[]) => lrCreate(...a),
    },
    holiday: { findMany: (...a: unknown[]) => holidayFindMany(...a) },
    attendance: { findMany: (...a: unknown[]) => attFindMany(...a) },
  };
}

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    $transaction: (...a: unknown[]) => transactionFn(...a),
    employee: { findUnique: (...a: unknown[]) => empFindUnique(...a) },
    leaveRequest: { findUnique: (...a: unknown[]) => lrFindUnique(...a) },
  },
  prismaRaw: {
    leaveRequest: { findUnique: (...a: unknown[]) => lrFindUnique(...a) },
  },
}));

import { approveLeaveRequest, rejectLeaveRequest } from './admin';

// ── helpers ───────────────────────────────────────────────────────────────────
const BRANCH_A = '00000000-0000-0000-0000-00000000000a';
const BRANCH_B = '00000000-0000-0000-0000-00000000000b';

/** One scoped (branchId set) assignment granting `perm`. */
function scopedTo(branchId: string, perm: string) {
  return [{ branchId, role: { permissions: [perm], isSuperadmin: false, archivedAt: null } }];
}
function globalGrant(perm: string) {
  return [{ branchId: null, role: { permissions: [perm], isSuperadmin: false, archivedAt: null } }];
}

/** A pending leave request whose employee lives in `home` (+ optional assigned). */
function pendingReq(home: string, assigned: string[] = []) {
  return {
    id: 'lr1',
    status: 'Pending',
    employeeId: 'e1',
    leaveTypeId: 'lt1',
    startDate: new Date('2026-07-01'),
    endDate: new Date('2026-07-01'),
    unit: 'FullDay',
    startTime: null,
    endTime: null,
    employee: {
      firstName: 'สมชาย',
      userId: 'u1',
      salaryType: 'Monthly',
      baseSalary: '10000',
      branchId: home,
      assignedBranchIds: assigned,
    },
    leaveType: { name: 'ลากิจ', nameByLocale: null, annualQuota: 0, overQuotaPolicy: 'Block' },
  };
}

describe('rejectLeaveRequest — branch act-on gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({ user: { id: 'actor' } });
    transactionFn.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(txStub()));
    lrUpdate.mockResolvedValue({});
  });

  it('scoped actor on an out-of-scope request → not-found, no update', async () => {
    getUserAssignments.mockResolvedValue(scopedTo(BRANCH_A, 'leave.approve'));
    lrFindUnique.mockResolvedValue({
      id: 'lr1',
      status: 'Pending',
      startDate: new Date('2026-07-01'),
      endDate: new Date('2026-07-01'),
      employee: { firstName: 'ก', userId: 'u1', branchId: BRANCH_B, assignedBranchIds: [] },
      leaveType: { name: 'ลากิจ', nameByLocale: null },
    });

    const res = await rejectLeaveRequest({ leaveRequestId: 'lr1', note: 'ปฏิเสธทดสอบ' });
    expect(res).toMatchObject({ ok: false, code: 'not-found' });
    expect(lrUpdate).not.toHaveBeenCalled();
  });

  it('scoped actor on an in-scope request → updates to Rejected', async () => {
    getUserAssignments.mockResolvedValue(scopedTo(BRANCH_A, 'leave.approve'));
    lrFindUnique.mockResolvedValue({
      id: 'lr1',
      status: 'Pending',
      startDate: new Date('2026-07-01'),
      endDate: new Date('2026-07-01'),
      employee: { firstName: 'ก', userId: 'u1', branchId: BRANCH_A, assignedBranchIds: [] },
      leaveType: { name: 'ลากิจ', nameByLocale: null },
    });

    const res = await rejectLeaveRequest({ leaveRequestId: 'lr1', note: 'ปฏิเสธทดสอบ' });
    expect(res).toMatchObject({ ok: true });
    expect(lrUpdate).toHaveBeenCalled();
  });

  it('global actor on an out-of-branch request → gate does NOT fire, updates to Rejected', async () => {
    getUserAssignments.mockResolvedValue(globalGrant('leave.approve'));
    lrFindUnique.mockResolvedValue({
      id: 'lr1',
      status: 'Pending',
      startDate: new Date('2026-07-01'),
      endDate: new Date('2026-07-01'),
      employee: { firstName: 'ก', userId: 'u1', branchId: BRANCH_B, assignedBranchIds: [] },
      leaveType: { name: 'ลากิจ', nameByLocale: null },
    });

    const res = await rejectLeaveRequest({ leaveRequestId: 'lr1', note: 'ปฏิเสธทดสอบ' });
    expect(res).toMatchObject({ ok: true });
    expect(lrUpdate).toHaveBeenCalled();
  });
});

describe('approveLeaveRequest — branch act-on gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({ user: { id: 'actor' } });
    transactionFn.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(txStub()));
    holidayFindMany.mockResolvedValue([]);
    attFindMany.mockResolvedValue([]);
  });

  it('scoped actor on an out-of-scope request → not-found, gate blocks before holiday lookup', async () => {
    getUserAssignments.mockResolvedValue(scopedTo(BRANCH_A, 'leave.approve'));
    lrFindUnique.mockResolvedValue(pendingReq(BRANCH_B));

    const res = await approveLeaveRequest({ leaveRequestId: 'lr1', note: 'อนุมัติทดสอบ' });
    expect(res).toMatchObject({ ok: false, code: 'not-found' });
    expect(holidayFindMany).not.toHaveBeenCalled(); // proves the gate fired before the heavy path
    expect(attFindMany).not.toHaveBeenCalled();
  });

  it('scoped actor on an in-scope request → passes the gate (reaches holiday lookup)', async () => {
    getUserAssignments.mockResolvedValue(scopedTo(BRANCH_A, 'leave.approve'));
    lrFindUnique.mockResolvedValue(pendingReq(BRANCH_A));

    await approveLeaveRequest({ leaveRequestId: 'lr1', note: 'อนุมัติทดสอบ' });
    expect(holidayFindMany).toHaveBeenCalled(); // got past the gate
  });

  it('global actor on an out-of-branch request → gate does NOT fire, reaches holiday lookup', async () => {
    getUserAssignments.mockResolvedValue(globalGrant('leave.approve'));
    lrFindUnique.mockResolvedValue(pendingReq(BRANCH_B));

    await approveLeaveRequest({ leaveRequestId: 'lr1', note: 'อนุมัติทดสอบ' });
    expect(holidayFindMany).toHaveBeenCalled(); // got past the gate
  });
});

import { adminCreateLeaveRequest } from './admin';

describe('adminCreateLeaveRequest — branch act-on gate (on-behalf)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({ user: { id: 'actor' } });
  });

  function baseInput() {
    return {
      employeeId: 'e1',
      leaveTypeId: 'lt1',
      startDate: '2026-07-01',
      endDate: '2026-07-01',
      unit: 'FullDay' as const,
      reason: 'ลากิจธุระ',
    };
  }

  it('scoped actor choosing an out-of-scope employee → employee-not-found, no create', async () => {
    getUserAssignments.mockResolvedValue(scopedTo(BRANCH_A, 'leave.approve'));
    empFindUnique.mockResolvedValue({
      id: 'e1',
      archivedAt: null,
      status: 'Active',
      firstName: 'ก',
      lastName: 'ข',
      nickname: null,
      branchId: BRANCH_B,
      assignedBranchIds: [],
    });

    const res = await adminCreateLeaveRequest(baseInput());
    expect(res).toMatchObject({ ok: false, code: 'employee-not-found' });
    expect(lrCreate).not.toHaveBeenCalled();
  });

  it('scoped actor choosing an in-scope employee → passes the gate (reaches date validation)', async () => {
    getUserAssignments.mockResolvedValue(scopedTo(BRANCH_A, 'leave.approve'));
    empFindUnique.mockResolvedValue({
      id: 'e1',
      archivedAt: null,
      status: 'Active',
      firstName: 'ก',
      lastName: 'ข',
      nickname: null,
      branchId: BRANCH_A,
      assignedBranchIds: [],
    });

    // Bad dates → proves we got PAST the branch gate (gate returns employee-not-found).
    const res = await adminCreateLeaveRequest({ ...baseInput(), endDate: '2026-06-30' });
    expect(res).toMatchObject({ ok: false, code: 'bad-dates' });
  });

  it('global actor choosing an employee in a branch with no scoped entry → passes the gate (reaches date validation)', async () => {
    getUserAssignments.mockResolvedValue(globalGrant('leave.approve'));
    empFindUnique.mockResolvedValue({
      id: 'e1',
      archivedAt: null,
      status: 'Active',
      firstName: 'ก',
      lastName: 'ข',
      nickname: null,
      branchId: BRANCH_B,
      assignedBranchIds: [],
    });

    // Bad dates → proves the global actor passed the branch gate (did not return employee-not-found).
    const res = await adminCreateLeaveRequest({ ...baseInput(), endDate: '2026-06-30' });
    expect(res).toMatchObject({ ok: false, code: 'bad-dates' });
  });
});
