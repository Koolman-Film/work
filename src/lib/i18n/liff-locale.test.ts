/**
 * Unit tests for syncLiffLocale().
 *
 * The DB read must go through resolveSessionUser() (authUserId →
 * custom:line/lineUserId), so an ADMIN on LIFF — a LINE-minted session whose
 * auth id does not match their User.authUserId — is recognized as paired and
 * gets the "DB wins" cookie rewrite. Before the fix the raw authUserId lookup
 * missed and returned { paired: false } for admins.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const cookieSet = vi.fn();
const cookieGet = vi.fn();
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: (...a: unknown[]) => cookieGet(...a),
    set: (...a: unknown[]) => cookieSet(...a),
  }),
  headers: vi.fn().mockResolvedValue(new Map([['accept-language', 'th']])),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/resolve-session-user', () => ({ resolveSessionUser: vi.fn() }));

import { revalidatePath } from 'next/cache';
import { resolveSessionUser } from '@/lib/auth/resolve-session-user';
import { LOCALE_COOKIE_NAME } from './config';
import { syncLiffLocale } from './liff-locale';

const mockedResolve = vi.mocked(resolveSessionUser);
const mockedRevalidate = vi.mocked(revalidatePath);

const LINE_SUB = 'U1234567890abcdef1234567890abcdef';

beforeEach(() => {
  vi.clearAllMocks();
  cookieGet.mockReturnValue({ value: 'th' }); // current cookie locale
});

describe('syncLiffLocale', () => {
  it('recognizes a paired admin (resolved via lineUserId) and applies DB-wins', async () => {
    mockedResolve.mockResolvedValue({
      id: 'user-1',
      locale: 'en', // DB differs from the 'th' cookie → rewrite expected
      localeChosenByEmployeeAt: new Date(),
      lineUserId: LINE_SUB,
      archivedAt: null,
    });

    const result = await syncLiffLocale();

    expect(result.paired).toBe(true);
    expect(cookieSet).toHaveBeenCalledWith(LOCALE_COOKIE_NAME, 'en', expect.any(Object));
    expect(mockedRevalidate).toHaveBeenCalledWith('/', 'layout');
  });

  it('does not rewrite the cookie when DB locale already matches', async () => {
    mockedResolve.mockResolvedValue({
      id: 'user-1',
      locale: 'th', // same as cookie
      localeChosenByEmployeeAt: new Date(),
      lineUserId: LINE_SUB,
      archivedAt: null,
    });

    const result = await syncLiffLocale();

    expect(result.paired).toBe(true);
    expect(cookieSet).not.toHaveBeenCalled();
    expect(mockedRevalidate).not.toHaveBeenCalled();
  });

  it('returns { paired: false } when no user resolves', async () => {
    mockedResolve.mockResolvedValue(null);
    const result = await syncLiffLocale();
    expect(result).toEqual({ paired: false });
  });

  it('returns { paired: false } for a resolved user that is not LINE-paired', async () => {
    mockedResolve.mockResolvedValue({
      id: 'user-1',
      locale: 'en',
      localeChosenByEmployeeAt: null,
      lineUserId: null,
      archivedAt: null,
    });
    const result = await syncLiffLocale();
    expect(result).toEqual({ paired: false });
  });
});
