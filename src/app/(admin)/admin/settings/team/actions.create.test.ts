import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Map()) }));
vi.mock('@/lib/audit/log', () => ({ auditLog: vi.fn() }));

const createUser = vi.fn();
const deleteUser = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  getSupabaseAdminClient: () => ({ auth: { admin: { createUser, deleteUser } } }),
}));

const requirePermission = vi.fn();
const canDo = vi.fn();
vi.mock('@/lib/auth/check-permission', () => ({
  requirePermission: (...a: unknown[]) => requirePermission(...a),
  canDo: (...a: unknown[]) => canDo(...a),
}));

const userFindUnique = vi.fn();
const roleFindMany = vi.fn();
const branchFindUnique = vi.fn();
const userCreate = vi.fn();
const assignmentCreateMany = vi.fn();
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: {
      findUnique: (...a: unknown[]) => userFindUnique(...a),
      create: (...a: unknown[]) => userCreate(...a),
    },
    roleDefinition: { findMany: (...a: unknown[]) => roleFindMany(...a) },
    branch: { findUnique: (...a: unknown[]) => branchFindUnique(...a) },
    userRoleAssignment: { createMany: (...a: unknown[]) => assignmentCreateMany(...a) },
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        user: { create: (...a: unknown[]) => userCreate(...a) },
        userRoleAssignment: { createMany: (...a: unknown[]) => assignmentCreateMany(...a) },
      }),
  },
}));

import { createTeamMember } from './actions';

function fd(email: string, password: string, rows: [string, string][]) {
  const f = new FormData();
  f.set('email', email);
  f.set('password', password);
  for (const [roleId, branchId] of rows) {
    f.append('roleId', roleId);
    f.append('branchId', branchId);
  }
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  userFindUnique.mockResolvedValue(null); // email not taken
  userCreate.mockResolvedValue({ id: 'u-new' });
  assignmentCreateMany.mockResolvedValue({ count: 1 });
  createUser.mockResolvedValue({ data: { user: { id: 'auth-new' } }, error: null });
});

describe('createTeamMember', () => {
  it('Superadmin creates a custom role @ branch → createMany with the row, redirect to edit', async () => {
    requirePermission.mockResolvedValue({ user: { id: 'actor' }, tier: 'Superadmin' });
    canDo.mockResolvedValue(true);
    roleFindMany.mockResolvedValue([
      { id: 'r-check', key: 'checker01', isSuperadmin: false, isSystem: false, archivedAt: null },
    ]);
    branchFindUnique.mockResolvedValue({ id: 'b1', archivedAt: null });

    await expect(createTeamMember(fd('a@x.io', 'password1', [['r-check', 'b1']]))).rejects.toThrow(
      'REDIRECT:/admin/settings/team/u-new/edit',
    );
    expect(createUser).toHaveBeenCalledOnce();
    expect(assignmentCreateMany).toHaveBeenCalledWith({
      data: [{ userId: 'u-new', roleId: 'r-check', branchId: 'b1' }],
    });
  });

  it('Admin granting the superadmin role is rejected before any auth user is created', async () => {
    requirePermission.mockResolvedValue({ user: { id: 'actor' }, tier: 'Admin' });
    roleFindMany.mockResolvedValue([
      { id: 'r-sa', key: 'superadmin', isSuperadmin: true, isSystem: true, archivedAt: null },
    ]);

    await expect(createTeamMember(fd('a@x.io', 'password1', [['r-sa', 'global']]))).rejects.toThrow(
      /REDIRECT:.*error=/,
    );
    expect(createUser).not.toHaveBeenCalled();
  });

  it('rejects a branch-scoped grant where the actor lacks role.assign at that branch', async () => {
    requirePermission.mockResolvedValue({ user: { id: 'actor' }, tier: 'Admin' });
    canDo.mockResolvedValue(false); // actor has no role.assign at branch b1
    roleFindMany.mockResolvedValue([
      { id: 'r-check', key: 'checker01', isSuperadmin: false, isSystem: false, archivedAt: null },
    ]);
    branchFindUnique.mockResolvedValue({ id: 'b1', archivedAt: null });

    await expect(createTeamMember(fd('a@x.io', 'password1', [['r-check', 'b1']]))).rejects.toThrow(
      /REDIRECT:.*error=/,
    );
    expect(createUser).not.toHaveBeenCalled();
  });
});
