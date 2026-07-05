/** Branch-scope enforcement for overtime (Spec B-OT). */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const attendanceFindMany = vi.fn(async (..._a: unknown[]) => [] as unknown[]);
const otFindMany = vi.fn(async (..._a: unknown[]) => [] as unknown[]);
const payrollConfigFindFirst = vi.fn(async (..._a: unknown[]) => ({ otThresholdMinutes: 30 }));
const empFindUnique = vi.fn();
const otCreate = vi.fn(async (..._a: unknown[]) => ({ id: 'ot-new' }));
const otUpdate = vi.fn(async (..._a: unknown[]) => ({ id: 'ot1' }));
const otFindUniqueVoid = vi.fn();
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    attendance: { findMany: (...a: unknown[]) => attendanceFindMany(...a) },
    overtimeEntry: {
      findMany: (...a: unknown[]) => otFindMany(...a),
      create: (...a: unknown[]) => otCreate(...a),
      update: (...a: unknown[]) => otUpdate(...a),
      findUnique: (...a: unknown[]) => otFindUniqueVoid(...a),
    },
    payrollConfig: { findFirst: (...a: unknown[]) => payrollConfigFindFirst(...a) },
    employee: { findUnique: (...a: unknown[]) => empFindUnique(...a) },
  },
}));

vi.mock('next/navigation', () => ({
  redirect: (u: string) => {
    throw new Error(`REDIRECT:${u}`);
  },
}));
const requirePermission = vi.fn();
const getUserAssignments = vi.fn();
vi.mock('@/lib/auth/check-permission', () => ({
  requirePermission: (...a: unknown[]) => requirePermission(...a),
  getUserAssignments: (...a: unknown[]) => getUserAssignments(...a),
}));
vi.mock('@/lib/audit/log', () => ({ auditLog: vi.fn() }));
vi.mock('@/lib/leave/leave-config', () => ({ getLeaveConfig: vi.fn(async () => ({})) }));

import { getOtCandidates } from './candidates';
import { approveOt, dismissOt, voidOt } from './actions';

const BRANCH_A = '00000000-0000-0000-0000-00000000000a';
const BRANCH_B = '00000000-0000-0000-0000-00000000000b';
function scoped(perm: string, branchId: string | null) {
  return [{ branchId, role: { permissions: [perm], isSuperadmin: false, archivedAt: null } }];
}
function fd(entries: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe('getOtCandidates — branch scope', () => {
  beforeEach(() => vi.clearAllMocks());

  it('scoped actor: attendance query carries the employee branch scope', async () => {
    await getOtCandidates({ ym: '2026-07' }, [BRANCH_A]);
    expect(attendanceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          employee: { OR: [{ branchId: { in: [BRANCH_A] } }, { assignedBranchIds: { hasSome: [BRANCH_A] } }] },
        }),
      }),
    );
  });

  it("global actor ('all'): no employee scope added", async () => {
    await getOtCandidates({ ym: '2026-07' }, 'all');
    const arg = attendanceFindMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(arg.where).not.toHaveProperty('employee');
  });
});

describe('approveOt / dismissOt — act-on gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({ user: { id: 'actor' } });
  });

  it('scoped actor on an out-of-scope employee → redirect, no OT created', async () => {
    getUserAssignments.mockResolvedValue(scoped('attendance.overtime.manage', BRANCH_A));
    empFindUnique.mockResolvedValue({ branchId: BRANCH_B, assignedBranchIds: [] });
    await expect(
      dismissOt(fd({ ym: '2026-07', employeeId: 'e1', date: '2026-07-10' })),
    ).rejects.toThrow(/REDIRECT:/);
    expect(otCreate).not.toHaveBeenCalled();
  });

  it('scoped actor on an in-scope employee → creates', async () => {
    getUserAssignments.mockResolvedValue(scoped('attendance.overtime.manage', BRANCH_A));
    empFindUnique.mockResolvedValue({ branchId: BRANCH_A, assignedBranchIds: [] });
    await dismissOt(fd({ ym: '2026-07', employeeId: 'e1', date: '2026-07-10' })).catch(() => {});
    expect(otCreate).toHaveBeenCalled();
  });

  it('rotating staff: home out-of-scope but assigned in-scope → creates', async () => {
    getUserAssignments.mockResolvedValue(scoped('attendance.overtime.manage', BRANCH_A));
    empFindUnique.mockResolvedValue({ branchId: BRANCH_B, assignedBranchIds: [BRANCH_A] });
    await dismissOt(fd({ ym: '2026-07', employeeId: 'e1', date: '2026-07-10' })).catch(() => {});
    expect(otCreate).toHaveBeenCalled();
  });

  it('global actor → creates for any employee', async () => {
    getUserAssignments.mockResolvedValue(scoped('attendance.overtime.manage', null));
    empFindUnique.mockResolvedValue({ branchId: BRANCH_B, assignedBranchIds: [] });
    await dismissOt(fd({ ym: '2026-07', employeeId: 'e1', date: '2026-07-10' })).catch(() => {});
    expect(otCreate).toHaveBeenCalled();
  });
});

describe('voidOt — act-on gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({ user: { id: 'actor' } });
  });

  it('scoped actor voiding an out-of-scope entry → redirect, no update', async () => {
    getUserAssignments.mockResolvedValue(scoped('attendance.overtime.manage', BRANCH_A));
    otFindUniqueVoid.mockResolvedValue({ employee: { branchId: BRANCH_B, assignedBranchIds: [] } });
    await expect(voidOt(fd({ ym: '2026-07', id: 'ot1' }))).rejects.toThrow(/REDIRECT:/);
    expect(otUpdate).not.toHaveBeenCalled();
  });

  it('scoped actor voiding an in-scope entry → soft-deletes', async () => {
    getUserAssignments.mockResolvedValue(scoped('attendance.overtime.manage', BRANCH_A));
    otFindUniqueVoid.mockResolvedValue({ employee: { branchId: BRANCH_A, assignedBranchIds: [] } });
    await voidOt(fd({ ym: '2026-07', id: 'ot1' })).catch(() => {});
    expect(otUpdate).toHaveBeenCalled();
  });
});
