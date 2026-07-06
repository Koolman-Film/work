import { prisma } from '@/lib/db/prisma';
import { createClient } from '@/lib/supabase/server';

/**
 * The minimal User shape the locale layer needs. Deliberately lean — a
 * single select serves all three callers (setLocale, syncLiffLocale,
 * login-time restore).
 */
export type SessionUser = {
  id: string;
  locale: string | null;
  localeChosenByEmployeeAt: Date | null;
  lineUserId: string | null;
  archivedAt: Date | null;
};

const SESSION_USER_SELECT = {
  id: true,
  locale: true,
  localeChosenByEmployeeAt: true,
  lineUserId: true,
  archivedAt: true,
} as const;

/**
 * Resolve the current Supabase session to its app `User` row — the SAME
 * identity resolution `requireRole` uses, but non-throwing.
 *
 * Order:
 *   1. Primary lookup by `User.authUserId` (the common case: workers whose
 *      pairing binds authUserId to their LINE auth user, and admins on their
 *      email web session).
 *   2. Fallback by `custom:line` identity → `User.lineUserId`, ONLY when the
 *      primary misses. This is what makes an admin's LIFF session (a separate
 *      LINE-minted auth user, while their User row keeps authUserId on the
 *      email user — see link-line-to-admin.ts) resolve to the right row.
 *
 * Returns `null` (never notFound()) when unauthenticated or unmatched, so
 * best-effort callers (setLocale) and pre-render syncs can no-op cleanly.
 */
export async function resolveSessionUser(): Promise<SessionUser | null> {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return null;

  let user = await prisma.user.findUnique({
    where: { authUserId: authUser.id },
    select: SESSION_USER_SELECT,
  });

  if (!user) {
    const lineSub = (authUser.identities ?? []).find((i) => i.provider === 'custom:line')?.id;
    if (lineSub) {
      user = await prisma.user.findUnique({
        where: { lineUserId: lineSub },
        select: SESSION_USER_SELECT,
      });
    }
  }

  return user;
}
