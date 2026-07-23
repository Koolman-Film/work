import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Map()) }));

const auditLogTx = vi.fn();
vi.mock('@/lib/audit/log', () => ({ auditLogTx: (...a: unknown[]) => auditLogTx(...a) }));

const requirePermission = vi.fn();
vi.mock('@/lib/auth/check-permission', () => ({
  requirePermission: (...a: unknown[]) => requirePermission(...a),
}));
vi.mock('@/lib/auth/branch-scope', () => ({
  getPermittedBranches: vi.fn().mockResolvedValue({ kind: 'all' }),
  canActOnEmployeeBranches: vi.fn().mockReturnValue(true),
}));

const leaveRequestFindUnique = vi.fn();
const leaveRequestFindMany = vi.fn();
const leaveTypeFindUnique = vi.fn();
const leaveEntitlementFindUnique = vi.fn();
const leaveRequestUpdate = vi.fn();
vi.mock('@/lib/db/prisma', () => {
  const client = {
    leaveRequest: {
      findUnique: (...a: unknown[]) => leaveRequestFindUnique(...a),
      findMany: (...a: unknown[]) => leaveRequestFindMany(...a),
      update: (...a: unknown[]) => leaveRequestUpdate(...a),
    },
    leaveType: { findUnique: (...a: unknown[]) => leaveTypeFindUnique(...a) },
    leaveEntitlement: { findUnique: (...a: unknown[]) => leaveEntitlementFindUnique(...a) },
    leaveConfig: { findFirst: vi.fn().mockResolvedValue(null) },
    payrollConfig: { findFirstOrThrow: vi.fn().mockResolvedValue({ workingDaysPerMonth: 26 }) },
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({ leaveRequest: { update: (...a: unknown[]) => leaveRequestUpdate(...a) } }),
  };
  return { prisma: client, prismaRaw: client };
});
vi.mock('./penalty-minutes', () => ({ penaltyMinutesBy: vi.fn().mockResolvedValue(new Map()) }));

import { correctLeaveType, previewLeaveTypeCorrection } from './correct-type';

const OLD_TYPE = 'type-personal';
const NEW_TYPE = 'type-sick';
function baseRequest(over: Record<string, unknown> = {}) {
  return {
    id: 'req-1',
    employeeId: 'emp-1',
    leaveTypeId: OLD_TYPE,
    startDate: new Date('2026-07-10'),
    status: 'Approved',
    deletedAt: null,
    deductedInPayrollId: null,
    reviewedAt: new Date('2026-07-10'),
    createdAt: new Date('2026-07-10'),
    chargedMinutes: 480,
    overQuotaMinutes: 480,
    deductAmount: 480,
    leaveType: { name: 'ลากิจ', overQuotaPolicy: 'DeductPay' },
    employee: { salaryType: 'Monthly', baseSalary: 15000, branchId: 'b1', assignedBranchIds: [] },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue({ user: { id: 'admin-1' } });
  leaveTypeFindUnique.mockResolvedValue({
    id: NEW_TYPE,
    name: 'ลาป่วย',
    overQuotaPolicy: 'DeductPay',
    annualQuota: 30,
  });
  leaveEntitlementFindUnique.mockResolvedValue(null); // fall back to annualQuota
  leaveRequestFindMany.mockResolvedValue([]); // no siblings by default
});

describe('correctLeaveType — guards', () => {
  it('refuses a paid (swept) request even if the UI submits it', async () => {
    leaveRequestFindUnique.mockResolvedValue(baseRequest({ deductedInPayrollId: 'pay-1' }));
    const r = await correctLeaveType({
      leaveRequestId: 'req-1',
      newLeaveTypeId: NEW_TYPE,
      note: 'ผิดประเภท',
    });
    expect(r).toEqual({ ok: false, message: expect.stringContaining('จ่ายแล้ว') });
    expect(leaveRequestUpdate).not.toHaveBeenCalled();
  });

  it('refuses when the note is blank', async () => {
    leaveRequestFindUnique.mockResolvedValue(baseRequest());
    const r = await correctLeaveType({
      leaveRequestId: 'req-1',
      newLeaveTypeId: NEW_TYPE,
      note: '  ',
    });
    expect(r.ok).toBe(false);
    expect(leaveRequestUpdate).not.toHaveBeenCalled();
  });

  it('refuses when the target type is the same as the current type', async () => {
    leaveRequestFindUnique.mockResolvedValue(baseRequest());
    leaveTypeFindUnique.mockResolvedValue({
      id: OLD_TYPE,
      name: 'ลากิจ',
      overQuotaPolicy: 'DeductPay',
      annualQuota: 3,
    });
    const r = await correctLeaveType({
      leaveRequestId: 'req-1',
      newLeaveTypeId: OLD_TYPE,
      note: 'x',
    });
    expect(r.ok).toBe(false);
    expect(leaveRequestUpdate).not.toHaveBeenCalled();
  });

  it('refuses a Block-policy target type', async () => {
    leaveRequestFindUnique.mockResolvedValue(baseRequest());
    leaveTypeFindUnique.mockResolvedValue({
      id: 'type-vac',
      name: 'ลาพักร้อน',
      overQuotaPolicy: 'Block',
      annualQuota: 6,
    });
    const r = await correctLeaveType({
      leaveRequestId: 'req-1',
      newLeaveTypeId: 'type-vac',
      note: 'x',
    });
    expect(r.ok).toBe(false);
    expect(leaveRequestUpdate).not.toHaveBeenCalled();
  });

  it('refuses when the CURRENT type has a Block over-quota policy', async () => {
    leaveRequestFindUnique.mockResolvedValue(
      baseRequest({ leaveType: { name: 'ลาพักร้อน', overQuotaPolicy: 'Block' } }),
    );
    const r = await correctLeaveType({
      leaveRequestId: 'req-1',
      newLeaveTypeId: NEW_TYPE,
      note: 'x',
    });
    expect(r).toEqual({ ok: false, message: expect.stringContaining('ประเภทเดิมไม่รองรับการแก้') });
    expect(leaveRequestUpdate).not.toHaveBeenCalled();
    expect(auditLogTx).not.toHaveBeenCalled();
  });
});

describe('correctLeaveType — apply', () => {
  it('changes the type, zeroes the deduction, and writes one audit entry', async () => {
    leaveRequestFindUnique.mockResolvedValue(baseRequest());
    leaveRequestUpdate.mockResolvedValue({});
    const r = await correctLeaveType({
      leaveRequestId: 'req-1',
      newLeaveTypeId: NEW_TYPE,
      note: 'พนักงานป่วยจริง',
    });
    expect(r).toEqual({ ok: true });
    // Moved request updated to the new type with a zeroed deduction (ลาป่วย 30 days free).
    const movedCall = leaveRequestUpdate.mock.calls.find((c) => c[0].where.id === 'req-1');
    expect(movedCall![0].data.leaveTypeId).toBe(NEW_TYPE);
    expect(movedCall![0].data.deductAmount).toBeNull();
    expect(movedCall![0].data.overQuotaMinutes).toBe(0);
    expect(auditLogTx).toHaveBeenCalledTimes(1);
    expect(auditLogTx.mock.calls[0]![1].action).toBe('leave.correct-type');
  });

  it('surfaces the STALE message when the request is paid between load and commit', async () => {
    leaveRequestFindUnique.mockResolvedValue(baseRequest());
    // Simulate a concurrent payroll sweep: the extended `where` on the moved
    // request's update (deductedInPayrollId: null, deletedAt: null) no longer
    // matches by the time the transaction runs, so Prisma raises P2025.
    leaveRequestUpdate.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('No record was found for an update.', {
        code: 'P2025',
        clientVersion: '5.0.0',
      }),
    );
    const r = await correctLeaveType({
      leaveRequestId: 'req-1',
      newLeaveTypeId: NEW_TYPE,
      note: 'พนักงานป่วยจริง',
    });
    expect(r).toEqual({
      ok: false,
      message: expect.stringContaining('สถานะเปลี่ยนไประหว่างดำเนินการ — กรุณาเปิดใหม่'),
    });
    expect(auditLogTx).not.toHaveBeenCalled();
  });

  it('surfaces the STALE message when a SIBLING is swept between load and commit (paid=locked parity)', async () => {
    leaveRequestFindUnique.mockResolvedValue(baseRequest());
    // An unswept sibling in the OLD group whose split will shift once the
    // moved request leaves the group (unlimited quota here, so the replay
    // recomputes it to over=0/deduct=null — different from its stored
    // 50/500 — which is exactly what puts it in ripple.siblingWrites).
    leaveRequestFindMany
      .mockResolvedValueOnce([
        {
          id: 'sib-1',
          chargedMinutes: 200,
          overQuotaMinutes: 50,
          deductAmount: 500,
          reviewedAt: new Date('2026-07-05'),
          createdAt: new Date('2026-07-05'),
          deductedInPayrollId: null,
        },
      ]) // oldRows
      .mockResolvedValueOnce([]); // newRows
    leaveRequestUpdate
      .mockResolvedValueOnce({}) // moved request update succeeds
      .mockRejectedValueOnce(
        // Concurrent payroll sweep of the SIBLING: its guarded where no
        // longer matches by the time the transaction runs, so Prisma raises
        // P2025 — same shape as the moved-row guard's failure mode.
        new Prisma.PrismaClientKnownRequestError('No record was found for an update.', {
          code: 'P2025',
          clientVersion: '5.0.0',
        }),
      );

    const r = await correctLeaveType({
      leaveRequestId: 'req-1',
      newLeaveTypeId: NEW_TYPE,
      note: 'พนักงานป่วยจริง',
    });

    expect(r).toEqual({
      ok: false,
      message: expect.stringContaining('สถานะเปลี่ยนไประหว่างดำเนินการ — กรุณาเปิดใหม่'),
    });
    // Transaction rolled back entirely — the audit write must not have landed.
    expect(auditLogTx).not.toHaveBeenCalled();
    // The sibling update must carry the SAME atomic paid/deleted guard as the
    // moved row's update — reverting it to `{ id: w.id }` alone would make
    // this assertion fail even though the mock above rejects unconditionally.
    const siblingCall = leaveRequestUpdate.mock.calls.find(
      (c) => (c[0] as { where: { id: string } }).where.id === 'sib-1',
    );
    expect(siblingCall![0].where).toEqual({
      id: 'sib-1',
      deductedInPayrollId: null,
      deletedAt: null,
    });
  });
});

describe('previewLeaveTypeCorrection', () => {
  it('returns the ripple without writing anything', async () => {
    leaveRequestFindUnique.mockResolvedValue(baseRequest());
    const r = await previewLeaveTypeCorrection('req-1', NEW_TYPE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ripple.moved.deductAmount).toBeNull();
    expect(r.ripple.netDeductDelta).toBe(-480);
    expect(leaveRequestUpdate).not.toHaveBeenCalled();
  });
});
