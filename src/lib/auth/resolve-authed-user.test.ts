import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { createClient } from '@/lib/supabase/server';
// Mock the Supabase server client + prisma exactly as require-role-line-fallback.test.ts does.
import { resolveAuthedUser } from './require-role';

vi.mock('@/lib/supabase/server');
vi.mock('@/lib/db/prisma', () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

describe('resolveAuthedUser', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns a custom-only user (tier-less) without throwing', async () => {
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'auth-1', identities: [] } } }),
      },
    });
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'u1',
      email: 'checker@x.io',
      authUserId: 'auth-1',
      archivedAt: null,
      employee: null,
      roleAssignments: [
        {
          branchId: null,
          role: {
            key: 'checker01',
            name: 'Checker01',
            isSuperadmin: false,
            archivedAt: null,
            permissions: ['attendance.read'],
          },
        },
      ],
    });

    const res = await resolveAuthedUser();
    expect(res.user.id).toBe('u1');
    expect(res.authUserId).toBe('auth-1');
    expect(res.assignments).toHaveLength(1);
    expect(res.assignments[0]?.role.permissions).toEqual(['attendance.read']);
  });
});
