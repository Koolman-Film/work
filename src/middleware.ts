/**
 * Next.js middleware — runs on every request before page render.
 *
 * Responsibilities:
 *   1. Refresh Supabase session (rotates expired access tokens, writes
 *      Set-Cookie headers so the browser persists).
 *   2. Guard protected route prefixes — unauthenticated requests to
 *      /admin/* /owner/* /liff/* get redirected to /login.
 *   3. Bounce authenticated users away from /login back to their home.
 *
 * Role-based authorization (admin vs owner vs employee) happens *inside*
 * each route group via `requireRole()` once the User table exists (W1c).
 * Middleware just handles "logged in or not".
 */

import { type NextRequest, NextResponse } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

// Routes that require a logged-in user (any role)
const PROTECTED_PREFIXES = ['/admin', '/owner', '/liff'];

// Routes that should bounce a logged-in user elsewhere (auth screens)
const AUTH_PREFIXES = ['/login', '/reset-password', '/update-password'];

export async function middleware(request: NextRequest) {
  const { supabaseResponse, user } = await updateSession(request);
  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
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
