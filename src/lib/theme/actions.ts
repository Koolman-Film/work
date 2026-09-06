'use server';

/**
 * `setTheme()` — Server Action behind the theme toggle.
 *
 * Cookie only. Unlike `setLocale`, there is no DB column: theme is a
 * per-device preference by nature (the same person legitimately wants dark on
 * a phone at night and light on a desktop next to a window), and LIFF visitors
 * have no User row until /liff/pair binds one.
 *
 * `revalidatePath('/', 'layout')` re-runs the root layout so the new
 * `data-theme` is stamped server-side. Keeping the switch on the server means
 * there is no intermediate client state for the page to flash through.
 */

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { isTheme, THEME_COOKIE_MAX_AGE, THEME_COOKIE_NAME, type Theme } from './config';

export async function setTheme(theme: Theme): Promise<{ ok: boolean; theme: Theme | null }> {
  // Validate at the boundary — the client can post anything.
  if (!isTheme(theme)) return { ok: false, theme: null };

  const cookieStore = await cookies();
  cookieStore.set(THEME_COOKIE_NAME, theme, {
    maxAge: THEME_COOKIE_MAX_AGE,
    sameSite: 'lax',
    path: '/',
    // Not HttpOnly: the toggle is a client component and reads this to
    // highlight the current selection. Non-sensitive.
    httpOnly: false,
  });

  revalidatePath('/', 'layout');
  return { ok: true, theme };
}
