import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

const requirePermission = vi.fn();
const getUserAssignments = vi.fn();
vi.mock('@/lib/auth/check-permission', () => ({
  requirePermission: (...a: unknown[]) => requirePermission(...a),
  getUserAssignments: (...a: unknown[]) => getUserAssignments(...a),
}));

import { requireGlobalPermission } from './require-global-permission';

const globalGrant = [
  {
    branchId: null,
    role: { permissions: ['payroll.read'], isSuperadmin: false, archivedAt: null },
  },
];
const scopedGrant = [
  {
    branchId: 'b1',
    role: { permissions: ['payroll.read'], isSuperadmin: false, archivedAt: null },
  },
];
const superadmin = [
  { branchId: null, role: { permissions: [], isSuperadmin: true, archivedAt: null } },
];

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue({ user: { id: 'u1' }, authUserId: 'a1', tier: 'Admin' });
});

describe('requireGlobalPermission', () => {
  it('global grant → returns the result', async () => {
    getUserAssignments.mockResolvedValue(globalGrant);
    const r = await requireGlobalPermission('payroll.read');
    expect(r).toMatchObject({ user: { id: 'u1' } });
  });

  it('branch-scoped grant only → notFound', async () => {
    getUserAssignments.mockResolvedValue(scopedGrant);
    await expect(requireGlobalPermission('payroll.read')).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('global Superadmin (branchId=null, isSuperadmin) → returns (getPermittedBranches → all)', async () => {
    getUserAssignments.mockResolvedValue(superadmin);
    const r = await requireGlobalPermission('payroll.read');
    expect(r).toMatchObject({ user: { id: 'u1' } });
  });

  it('branch-scoped Superadmin assignment (branchId set) → notFound (not global)', async () => {
    getUserAssignments.mockResolvedValue([
      { branchId: 'b1', role: { permissions: [], isSuperadmin: true, archivedAt: null } },
    ]);
    await expect(requireGlobalPermission('payroll.read')).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
