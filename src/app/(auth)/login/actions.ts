'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { loginErrorMessage } from '@/lib/auth/login-error';
import { resolveSessionUser } from '@/lib/auth/resolve-session-user';
import { safeRedirect } from '@/lib/auth/safe-redirect';
import { isLocale, LOCALE_COOKIE_MAX_AGE, LOCALE_COOKIE_NAME } from '@/lib/i18n/config';
import { createClient } from '@/lib/supabase/server';

const SignInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  redirectTo: z.string().optional().default(''),
});

export async function signIn(formData: FormData) {
  const raw = {
    email: formData.get('email'),
    password: formData.get('password'),
    redirectTo: formData.get('redirectTo') ?? '',
  };
  const parsed = SignInSchema.safeParse(raw);
  if (!parsed.success) {
    redirect(`/login?error=${encodeURIComponent('กรุณากรอกอีเมลและรหัสผ่าน')}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    const message = loginErrorMessage(error);
    redirect(`/login?error=${encodeURIComponent(message)}`);
  }

  // Login-time DB→cookie sync: restore the user's saved language on THIS
  // device from User.locale, so the preference follows them across devices.
  // The web login path has no other per-request DB read of the locale, so
  // without this a fresh device falls back to Accept-Language. Best-effort —
  // never blocks login.
  try {
    const sessionUser = await resolveSessionUser();
    if (sessionUser && isLocale(sessionUser.locale)) {
      const cookieStore = await cookies();
      cookieStore.set(LOCALE_COOKIE_NAME, sessionUser.locale, {
        maxAge: LOCALE_COOKIE_MAX_AGE,
        sameSite: 'lax',
        path: '/',
        httpOnly: false,
      });
    }
  } catch (err) {
    console.warn('[login.signIn] locale restore skipped', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Success → bounce to the originally-requested URL (or home).
  redirect(safeRedirect(parsed.data.redirectTo));
}

// Sign out — exposed for direct import; the canonical entry point is
// the route handler at /logout (form POST / GET) so plain HTML works.
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: 'local' });
  redirect('/login');
}
