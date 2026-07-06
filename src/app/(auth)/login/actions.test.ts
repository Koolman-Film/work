/**
 * Unit tests for the signIn login action's locale restore.
 *
 * After a successful email sign-in, the action must rewrite the NEXT_LOCALE
 * cookie from the user's saved `User.locale` — that is the login-time
 * DB→cookie sync that restores an admin's language on a fresh device/browser
 * (the "Phase 2" that resolve.ts flagged as unwired). It must NOT run on a
 * failed sign-in, and an unset/invalid saved locale must not touch the cookie.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const cookieSet = vi.fn();
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ set: (...a: unknown[]) => cookieSet(...a) }),
}));
vi.mock('next/navigation', () => ({
  redirect: (u: string) => {
    throw new Error(`REDIRECT:${u}`);
  },
}));
const signInWithPassword = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { signInWithPassword: (...a: unknown[]) => signInWithPassword(...a) },
  }),
}));
vi.mock('@/lib/auth/resolve-session-user', () => ({ resolveSessionUser: vi.fn() }));

import { resolveSessionUser } from '@/lib/auth/resolve-session-user';
import { LOCALE_COOKIE_NAME } from '@/lib/i18n/config';
import { signIn } from './actions';

const mockedResolve = vi.mocked(resolveSessionUser);

function form(email = 'admin@koolman.local', password = 'pw') {
  const fd = new FormData();
  fd.set('email', email);
  fd.set('password', password);
  return fd;
}

beforeEach(() => vi.clearAllMocks());

describe('signIn — login-time locale restore', () => {
  it('rewrites NEXT_LOCALE from User.locale after a successful sign-in', async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    // biome-ignore lint/suspicious/noExplicitAny: partial SessionUser
    mockedResolve.mockResolvedValue({ id: 'user-1', locale: 'en' } as any);

    // The action ends in redirect(), which our mock throws.
    await expect(signIn(form())).rejects.toThrow(/^REDIRECT:/);

    expect(cookieSet).toHaveBeenCalledWith(LOCALE_COOKIE_NAME, 'en', expect.any(Object));
  });

  it('does not touch the cookie when the saved locale is unset/invalid', async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    // biome-ignore lint/suspicious/noExplicitAny: partial SessionUser
    mockedResolve.mockResolvedValue({ id: 'user-1', locale: null } as any);

    await expect(signIn(form())).rejects.toThrow(/^REDIRECT:/);

    expect(cookieSet).not.toHaveBeenCalled();
  });

  it('does not restore locale on a failed sign-in (redirects to /login with error)', async () => {
    signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });

    await expect(signIn(form())).rejects.toThrow(/^REDIRECT:\/login\?error=/);

    expect(mockedResolve).not.toHaveBeenCalled();
    expect(cookieSet).not.toHaveBeenCalled();
  });
});
