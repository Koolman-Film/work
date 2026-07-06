/**
 * Unit tests for setLocale().
 *
 * The DB write must target the row returned by resolveSessionUser() BY ITS
 * PRIMARY KEY (`where: { id }`) — not by `authUserId`. That is the fix that
 * makes an admin's LIFF language choice (a LINE-minted session whose auth id
 * does NOT match their User.authUserId) actually persist to their real row.
 * The cookie write is unconditional; the DB write is best-effort.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const cookieSet = vi.fn();
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ set: (...a: unknown[]) => cookieSet(...a) }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { user: { update: vi.fn() } } }));
vi.mock('@/lib/auth/resolve-session-user', () => ({ resolveSessionUser: vi.fn() }));

import { resolveSessionUser } from '@/lib/auth/resolve-session-user';
import { prisma } from '@/lib/db/prisma';
import { setLocale } from './actions';
import { LOCALE_COOKIE_NAME } from './config';

const mockedResolve = vi.mocked(resolveSessionUser);
const mockedUpdate = vi.mocked(prisma.user.update);

beforeEach(() => vi.clearAllMocks());

describe('setLocale', () => {
  it('rejects an unsupported locale without writing anything', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: exercising the boundary guard
    const result = await setLocale('xx' as any);
    expect(result).toEqual({ ok: false, locale: null });
    expect(cookieSet).not.toHaveBeenCalled();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('writes the NEXT_LOCALE cookie and updates the resolved User row by id', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: partial SessionUser
    mockedResolve.mockResolvedValue({ id: 'user-1', archivedAt: null } as any);

    const result = await setLocale('en');

    expect(result).toEqual({ ok: true, locale: 'en' });
    expect(cookieSet).toHaveBeenCalledWith(LOCALE_COOKIE_NAME, 'en', expect.any(Object));

    expect(mockedUpdate).toHaveBeenCalledTimes(1);
    const arg = mockedUpdate.mock.calls[0]?.[0];
    expect(arg?.where).toEqual({ id: 'user-1' });
    expect(arg?.data).toMatchObject({ locale: 'en' });
    expect(arg?.data).toHaveProperty('localeChosenByEmployeeAt');
  });

  it('still sets the cookie but skips the DB write when no user resolves', async () => {
    mockedResolve.mockResolvedValue(null);

    const result = await setLocale('th');

    expect(result).toEqual({ ok: true, locale: 'th' });
    expect(cookieSet).toHaveBeenCalledWith(LOCALE_COOKIE_NAME, 'th', expect.any(Object));
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('does not throw if the DB write fails (best-effort persistence)', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: partial SessionUser
    mockedResolve.mockResolvedValue({ id: 'user-1', archivedAt: null } as any);
    mockedUpdate.mockRejectedValueOnce(new Error('db down'));

    const result = await setLocale('en');

    expect(result).toEqual({ ok: true, locale: 'en' });
    expect(cookieSet).toHaveBeenCalled();
  });
});
