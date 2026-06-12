/**
 * Next.js 16 proxy — runs on every request before page render.
 *
 * Renamed from `middleware.ts` per Next 16 convention (Vercel ships a separate
 * "Routing Middleware" product at the platform layer; calling this `proxy`
 * disambiguates).
 *
 * Responsibilities:
 *   1. Refresh Supabase session (rotates expired access tokens, writes
 *      Set-Cookie headers so the browser persists).
 *   2. Guard protected route prefixes — unauthenticated requests to
 *      /admin/* /owner/* /liff/* get redirected to /login.
 *   3. Bounce authenticated users away from /login back to their home.
 *
 * Role-based authorization (admin vs owner vs employee) happens *inside*
 * each route group via `requireRole()` (W1c). The proxy just handles
 * "logged in or not".
 */

import { type NextRequest, NextResponse } from 'next/server';
import { isLocale, LOCALE_COOKIE_MAX_AGE, LOCALE_COOKIE_NAME } from '@/lib/i18n/config';
import { resolveLocale } from '@/lib/i18n/resolve';
import { updateSession } from '@/lib/supabase/middleware';

// Routes that require a logged-in user (any role)
const PROTECTED_PREFIXES = ['/admin', '/owner', '/liff'];

// Carve-outs inside protected prefixes that are intentionally public.
//   /liff/pair is the LINE-login entry point — the user arrives there
//   WITHOUT a Supabase session and the page itself does signInWithIdToken
//   to create one. Treating it as protected would loop them to /login.
//   /liff/admin/* is reachable from rich-menu deep links that may open the
//   LIFF webview WITHOUT a Supabase session. The pages gate server-side
//   (requireLiffAdmin → 404 without a session) while the admin layout's
//   LiffSessionGate runs liffBootstrap() and refreshes — a /login redirect
//   here would break that handshake.
const PUBLIC_INSIDE_PROTECTED: string[] = ['/liff/pair', '/liff/pair-admin', '/liff/admin'];

// Routes that should bounce a logged-in user elsewhere (auth screens)
const AUTH_PREFIXES = ['/login', '/reset-password', '/update-password'];

export async function proxy(request: NextRequest) {
  const { supabaseResponse, user } = await updateSession(request);
  const { pathname } = request.nextUrl;

  // ─── Locale cookie: set on first visit ─────────────────────────────────
  // The NEXT_LOCALE cookie is the per-request source of truth for next-intl
  // (see src/lib/i18n/request.ts). If the request has no cookie yet — or
  // a value that's no longer a supported locale (e.g., a locale we've
  // removed) — set it now from the Accept-Language header. We attach the
  // Set-Cookie to the *response* the supabase middleware already built so
  // we don't lose its refreshed-session headers.
  const existingLocale = request.cookies.get(LOCALE_COOKIE_NAME)?.value;
  if (!isLocale(existingLocale)) {
    const detected = resolveLocale({
      cookieValue: null,
      acceptLanguage: request.headers.get('accept-language'),
    });
    supabaseResponse.cookies.set(LOCALE_COOKIE_NAME, detected, {
      maxAge: LOCALE_COOKIE_MAX_AGE,
      sameSite: 'lax',
      path: '/',
      httpOnly: false,
    });
  }

  const isProtected =
    PROTECTED_PREFIXES.some((p) => pathname.startsWith(p)) &&
    !PUBLIC_INSIDE_PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const isAuthScreen = AUTH_PREFIXES.some((p) => pathname.startsWith(p));

  // Unauthenticated user hitting a protected page → /login?redirectTo=...
  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('redirectTo', pathname);
    return NextResponse.redirect(url);
  }

  // Authenticated user hitting an auth screen → bounce to /
  // (The home page will route them to /admin or /owner based on role in W1c.)
  if (isAuthScreen && user) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.searchParams.delete('redirectTo');
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    // Match everything except static assets, image optimization, favicon,
    // and the LIFF static endpoint (Stage 2 smoke).
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif)$).*)',
  ],
};
