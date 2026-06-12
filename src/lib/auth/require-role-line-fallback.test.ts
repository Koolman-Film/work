/**
 * Unit tests for the LIFF LINE-identity fallback in requireRole().
 *
 * Scenario under test: an admin paired via /liff/pair-admin keeps their
 * email auth.users id on User.authUserId, but their LIFF Supabase session
 * is a separate LINE-minted auth user. requireRole must fall back to
 * resolving the session's verified `custom:line` identity sub against
 * User.lineUserId — and ONLY when the primary authUserId lookup misses.
 *
 * Mocking style mirrors smoke.test.ts: prisma and the supabase server
 * client are stubbed at the module boundary; `notFound()` throws a
 * sentinel error we assert with rejects.toThrow().
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

import { prisma } from '@/lib/db/prisma';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from './require-role';

const mockedFindUnique = vi.mocked(prisma.user.findUnique);
const mockedCreateClient = vi.mocked(createClient);

const LINE_SUB = 'U1234567890abcdef1234567890abcdef';
const SESSION_AUTH_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

function stubSession(authUser: unknown) {
  mockedCreateClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: authUser } }),
    },
    // biome-ignore lint/suspicious/noExplicitAny: minimal supabase stub
  } as any);
}

function adminUserRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    authUserId: 'bbbbbbbb-0000-0000-0000-000000000002', // email auth id
    lineUserId: LINE_SUB,
    archivedAt: null,
    employee: null,
    roleAssignments: [{ role: { key: 'admin', isSuperadmin: false, archivedAt: null } }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('requireRole — custom:line identity fallback', () => {
  it('resolves an admin via custom:line identity when authUserId misses', async () => {
    stubSession({
      id: SESSION_AUTH_ID,
      identities: [{ provider: 'custom:line', id: LINE_SUB }],
    });
    // First lookup (authUserId) misses; second (lineUserId) hits.
    mockedFindUnique.mockResolvedValueOnce(null);
    // biome-ignore lint/suspicious/noExplicitAny: prisma mock
    mockedFindUnique.mockResolvedValueOnce(adminUserRow() as any);

    const result = await requireRole(['Admin']);

    expect(result.tier).toBe('Admin');
    expect(result.user.id).toBe('user-1');
    // CRITICAL: returned authUserId is the SESSION auth id (storage-path
    // security checks compare against it), not the User row's email auth id.
    expect(result.authUserId).toBe(SESSION_AUTH_ID);
    expect(mockedFindUnique).toHaveBeenCalledTimes(2);
    expect(mockedFindUnique.mock.calls[1]?.[0].where).toEqual({ lineUserId: LINE_SUB });
  });

  it('throws notFound when the line identity matches no User', async () => {
    stubSession({
      id: SESSION_AUTH_ID,
      identities: [{ provider: 'custom:line', id: LINE_SUB }],
    });
    mockedFindUnique.mockResolvedValue(null);

    await expect(requireRole(['Admin'])).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mockedFindUnique).toHaveBeenCalledTimes(2);
  });

  it('throws notFound for sessions with no custom:line identity (email users never fall back)', async () => {
    stubSession({
      id: SESSION_AUTH_ID,
      identities: [{ provider: 'email', id: SESSION_AUTH_ID }],
    });
    mockedFindUnique.mockResolvedValue(null);

    await expect(requireRole(['Admin'])).rejects.toThrow('NEXT_NOT_FOUND');
    // Only the primary lookup — no fallback query for email users.
    expect(mockedFindUnique).toHaveBeenCalledTimes(1);
  });

  it('throws notFound when the line-matched user is archived', async () => {
    stubSession({
      id: SESSION_AUTH_ID,
      identities: [{ provider: 'custom:line', id: LINE_SUB }],
    });
    mockedFindUnique.mockResolvedValueOnce(null);
    // biome-ignore lint/suspicious/noExplicitAny: prisma mock
    mockedFindUnique.mockResolvedValueOnce(adminUserRow({ archivedAt: new Date() }) as any);

    await expect(requireRole(['Admin'])).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mockedFindUnique).toHaveBeenCalledTimes(2);
  });

  it('throws notFound when the line-matched user has no role assignments', async () => {
    stubSession({
      id: SESSION_AUTH_ID,
      identities: [{ provider: 'custom:line', id: LINE_SUB }],
    });
    mockedFindUnique.mockResolvedValueOnce(null);
    // biome-ignore lint/suspicious/noExplicitAny: prisma mock
    mockedFindUnique.mockResolvedValueOnce(adminUserRow({ roleAssignments: [] }) as any);

    await expect(requireRole(['Admin'])).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mockedFindUnique).toHaveBeenCalledTimes(2);
  });

  it('worker fast path: authUserId match never triggers the lineUserId lookup', async () => {
    stubSession({
      id: SESSION_AUTH_ID,
      identities: [{ provider: 'custom:line', id: LINE_SUB }],
    });
    const workerRow = adminUserRow({
      authUserId: SESSION_AUTH_ID,
      employee: { id: 'emp-1', status: 'Active', canCheckIn: true },
      roleAssignments: [{ role: { key: 'staff', isSuperadmin: false, archivedAt: null } }],
    });
    // biome-ignore lint/suspicious/noExplicitAny: prisma mock
    mockedFindUnique.mockResolvedValueOnce(workerRow as any);

    const result = await requireRole(['Staff']);

    expect(result.tier).toBe('Staff');
    expect(mockedFindUnique).toHaveBeenCalledTimes(1);
    expect(mockedFindUnique.mock.calls[0]?.[0].where).toEqual({ authUserId: SESSION_AUTH_ID });
  });
});
