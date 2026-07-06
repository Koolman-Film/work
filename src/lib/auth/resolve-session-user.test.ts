/**
 * Unit tests for resolveSessionUser() — the non-throwing session→User
 * resolver used by the locale actions and login-time sync.
 *
 * It must mirror requireRole's identity resolution: primary lookup by
 * User.authUserId, then a `custom:line` → User.lineUserId fallback (and
 * ONLY when the primary misses). Unlike requireRole it never notFound()s —
 * it returns null so best-effort / pre-auth callers can no-op gracefully.
 *
 * Mocking style mirrors require-role-line-fallback.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { prisma } from '@/lib/db/prisma';
import { createClient } from '@/lib/supabase/server';
import { resolveSessionUser } from './resolve-session-user';

const mockedFindUnique = vi.mocked(prisma.user.findUnique);
const mockedCreateClient = vi.mocked(createClient);

const LINE_SUB = 'U1234567890abcdef1234567890abcdef';
const EMAIL_AUTH_ID = 'bbbbbbbb-0000-0000-0000-000000000002';
const LINE_AUTH_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

function stubSession(authUser: unknown) {
  mockedCreateClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: authUser } }) },
    // biome-ignore lint/suspicious/noExplicitAny: minimal supabase stub
  } as any);
}

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    locale: 'en',
    localeChosenByEmployeeAt: null,
    lineUserId: LINE_SUB,
    archivedAt: null,
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('resolveSessionUser', () => {
  it('returns null when there is no authenticated session', async () => {
    stubSession(null);
    const result = await resolveSessionUser();
    expect(result).toBeNull();
    expect(mockedFindUnique).not.toHaveBeenCalled();
  });

  it('resolves by authUserId on the primary lookup (no fallback query)', async () => {
    stubSession({ id: EMAIL_AUTH_ID, identities: [{ provider: 'email', id: EMAIL_AUTH_ID }] });
    // biome-ignore lint/suspicious/noExplicitAny: prisma mock
    mockedFindUnique.mockResolvedValueOnce(userRow({ authUserId: EMAIL_AUTH_ID }) as any);

    const result = await resolveSessionUser();

    expect(result?.id).toBe('user-1');
    expect(result?.locale).toBe('en');
    expect(mockedFindUnique).toHaveBeenCalledTimes(1);
    expect(mockedFindUnique.mock.calls[0]?.[0].where).toEqual({ authUserId: EMAIL_AUTH_ID });
  });

  it('falls back to lineUserId when authUserId misses (admin LIFF session)', async () => {
    // Admin: LIFF session is a LINE-minted auth user; the User row keeps
    // authUserId on the email user, so the primary lookup misses.
    stubSession({ id: LINE_AUTH_ID, identities: [{ provider: 'custom:line', id: LINE_SUB }] });
    mockedFindUnique.mockResolvedValueOnce(null);
    // biome-ignore lint/suspicious/noExplicitAny: prisma mock
    mockedFindUnique.mockResolvedValueOnce(userRow() as any);

    const result = await resolveSessionUser();

    expect(result?.id).toBe('user-1');
    expect(mockedFindUnique).toHaveBeenCalledTimes(2);
    expect(mockedFindUnique.mock.calls[1]?.[0].where).toEqual({ lineUserId: LINE_SUB });
  });

  it('does not fall back for email sessions (no custom:line identity)', async () => {
    stubSession({ id: EMAIL_AUTH_ID, identities: [{ provider: 'email', id: EMAIL_AUTH_ID }] });
    mockedFindUnique.mockResolvedValueOnce(null);

    const result = await resolveSessionUser();

    expect(result).toBeNull();
    expect(mockedFindUnique).toHaveBeenCalledTimes(1);
  });

  it('returns null when the line identity matches no User', async () => {
    stubSession({ id: LINE_AUTH_ID, identities: [{ provider: 'custom:line', id: LINE_SUB }] });
    mockedFindUnique.mockResolvedValue(null);

    const result = await resolveSessionUser();

    expect(result).toBeNull();
    expect(mockedFindUnique).toHaveBeenCalledTimes(2);
  });
});
