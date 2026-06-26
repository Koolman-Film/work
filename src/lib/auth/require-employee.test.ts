import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

import { prisma } from '@/lib/db/prisma';
import { createClient } from '@/lib/supabase/server';
import { requireEmployee } from './require-role';

const mockedFindUnique = vi.mocked(prisma.user.findUnique);
const mockedCreateClient = vi.mocked(createClient);

function stubSession(authUser: unknown) {
  mockedCreateClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: authUser } }) },
    // biome-ignore lint/suspicious/noExplicitAny: minimal supabase stub
  } as any);
}
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    authUserId: 'auth-1',
    lineUserId: 'line-1',
    archivedAt: null,
    employee: { id: 'emp-1', status: 'Active' },
    roleAssignments: [{ role: { key: 'staff', isSuperadmin: false, archivedAt: null } }],
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('requireEmployee', () => {
  it('passes a worker (Staff tier with an Employee)', async () => {
    stubSession({ id: 'auth-1', identities: [] });
    // biome-ignore lint/suspicious/noExplicitAny: prisma mock
    mockedFindUnique.mockResolvedValue(row() as any);
    const r = await requireEmployee();
    expect(r.employee.id).toBe('emp-1');
  });

  it('passes an admin-employee (Admin tier but has an Employee)', async () => {
    stubSession({ id: 'auth-1', identities: [] });
    mockedFindUnique.mockResolvedValue(
      // biome-ignore lint/suspicious/noExplicitAny: prisma mock
      row({
        roleAssignments: [
          { role: { key: 'staff', isSuperadmin: false, archivedAt: null } },
          { role: { key: 'admin', isSuperadmin: false, archivedAt: null } },
        ],
      }) as any,
    );
    const r = await requireEmployee();
    expect(r.tier).toBe('Admin');
    expect(r.employee.id).toBe('emp-1');
  });

  it('rejects a pure admin (no Employee record)', async () => {
    stubSession({ id: 'auth-1', identities: [] });
    mockedFindUnique.mockResolvedValue(
      // biome-ignore lint/suspicious/noExplicitAny: prisma mock
      row({
        employee: null,
        roleAssignments: [{ role: { key: 'admin', isSuperadmin: false, archivedAt: null } }],
      }) as any,
    );
    await expect(requireEmployee()).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
