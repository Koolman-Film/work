'use server';

/**
 * `setLocale()` — Server Action invoked by the language switcher.
 *
 * Two writes happen:
 *   1. NEXT_LOCALE cookie (always, used by next-intl on next request)
 *   2. User.locale column (if the actor is logged in — cross-device sync)
 *
 * The DB write is best-effort: a failed update (no User row yet, e.g.,
 * mid-pair for a brand-new Employee) shouldn't block the cookie write.
 * The user sees their language change immediately even if persistence
 * to the DB fails for some edge-case reason; they'll just need to
 * pick it again on another device.
 *
 * After both writes, we `revalidatePath('/', 'layout')` so that every
 * Server Component in the tree re-runs with the new locale. (Without
 * this, a client-side router.refresh() would also work, but
 * revalidatePath keeps the render fully on the server — fewer
 * intermediate states for the user.)
 *
 * When called by the worker (modal/switcher), `setLocale` also stamps
 * `User.localeChosenByEmployeeAt` — that flag is what stops the
 * first-run modal from reappearing. Admin default-setting uses a
 * separate action (`setEmployeeDefaultLocale`) that must NOT stamp it.
 */

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { resolveSessionUser } from '@/lib/auth/resolve-session-user';
import { prisma } from '@/lib/db/prisma';
import { isLocale, LOCALE_COOKIE_MAX_AGE, LOCALE_COOKIE_NAME, type Locale } from './config';

export async function setLocale(locale: Locale): Promise<{ ok: boolean; locale: Locale | null }> {
  // Validate at the boundary — the client could pass anything.
  if (!isLocale(locale)) {
    return { ok: false, locale: null };
  }

  // 1. Cookie write — the per-request source of truth.
  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE_NAME, locale, {
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: 'lax',
    path: '/',
    // Not HttpOnly: the language switcher (client component) reads it
    // to highlight the current selection. Non-sensitive data.
    httpOnly: false,
  });

  // 2. DB sync — best-effort, doesn't fail the action.
  //    resolveSessionUser (not requireRole) because this action is callable
  //    from /login pre-auth too — it returns null instead of notFound().
  //    Crucially it resolves via authUserId → custom:line/lineUserId, so an
  //    admin's LIFF session (LINE-minted, whose auth id doesn't match their
  //    User.authUserId) still updates the RIGHT row. We update by primary key
  //    (`id`) so both worker and admin sessions hit that resolved row.
  try {
    const sessionUser = await resolveSessionUser();
    if (sessionUser) {
      await prisma.user.update({
        where: { id: sessionUser.id },
        // This action is the WORKER's explicit choice (modal/switcher), so
        // stamp localeChosenByEmployeeAt — that's what stops the first-run
        // modal from reappearing. Admin default-setting uses a separate
        // action (setEmployeeDefaultLocale) that does NOT stamp this.
        data: { locale, localeChosenByEmployeeAt: new Date() },
      });
    }
  } catch (err) {
    // The most common reason: User row doesn't exist yet (brand-new
    // Employee mid-pair). Not actionable — log + continue.
    console.warn('[i18n.setLocale] DB sync skipped', {
      locale,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 3. Re-render every Server Component in the tree with the new locale.
  revalidatePath('/', 'layout');

  return { ok: true, locale };
}
