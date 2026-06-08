'use server';

import { revalidatePath } from 'next/cache';
import { cookies, headers } from 'next/headers';
import { prisma } from '@/lib/db/prisma';
import { createClient } from '@/lib/supabase/server';
import { isLocale, LOCALE_COOKIE_MAX_AGE, LOCALE_COOKIE_NAME, type Locale } from './config';
import { resolvePreselectLocale, shouldShowLanguageModal } from './modal-trigger';

export type LiffLocaleSync =
  | { paired: false }
  | { paired: true; showModal: boolean; preselect: Locale };

/**
 * LIFF entry reconciliation. Called once on mount by <LiffLocaleGate>.
 *
 * - Not signed in / not paired (pre-/mid-pair) → { paired: false }; the
 *   gate renders nothing.
 * - DB `locale` is authoritative for LIFF: if it is set and differs from
 *   the NEXT_LOCALE cookie, rewrite the cookie + revalidate so the
 *   admin's re-override takes effect on this visit. No DB change ⇒ no
 *   revalidate (no flash on the common path).
 * - Returns whether the first-run modal should show + its pre-selection.
 */
export async function syncLiffLocale(): Promise<LiffLocaleSync> {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return { paired: false };

  const dbUser = await prisma.user.findUnique({
    where: { authUserId: authUser.id },
    select: { locale: true, localeChosenByEmployeeAt: true, lineUserId: true, archivedAt: true },
  });
  // Only paired, active workers get the LIFF locale experience.
  if (!dbUser || dbUser.archivedAt || !dbUser.lineUserId) return { paired: false };

  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value ?? null;

  // DB wins: rewrite the cookie when the DB has a supported locale that
  // the cookie doesn't already match.
  if (isLocale(dbUser.locale) && dbUser.locale !== cookieLocale) {
    cookieStore.set(LOCALE_COOKIE_NAME, dbUser.locale, {
      maxAge: LOCALE_COOKIE_MAX_AGE,
      sameSite: 'lax',
      path: '/',
      httpOnly: false,
    });
    revalidatePath('/', 'layout');
  }

  const headerStore = await headers();
  return {
    paired: true,
    showModal: shouldShowLanguageModal(dbUser.localeChosenByEmployeeAt),
    preselect: resolvePreselectLocale({
      adminDefault: dbUser.locale,
      acceptLanguage: headerStore.get('accept-language'),
    }),
  };
}
