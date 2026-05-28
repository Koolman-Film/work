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
 */

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db/prisma';
import { createClient } from '@/lib/supabase/server';
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
  //    Why Supabase getUser() and not requireRole(): this action is
  //    callable from /login pre-auth too (user is picking language
  //    before signing in). requireRole would notFound() and break that.
  try {
    const supabase = await createClient();
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();
    if (authUser) {
      await prisma.user.update({
        where: { authUserId: authUser.id },
        data: { locale },
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
