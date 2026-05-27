/**
 * Supabase client + session refresh, for use inside Next.js middleware.
 *
 * Critical: this is where token refreshes are persisted back to the response
 * cookies. Without it, expired access tokens never get rotated server-side
 * and users silently lose their session mid-navigation.
 *
 * Reference: https://supabase.com/docs/guides/auth/server-side/nextjs
 *            https://github.com/supabase/ssr — `Initialize Supabase Client in Next.js Middleware`
 */

import { type CookieOptions, createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';

type CookieToSet = { name: string; value: string; options?: CookieOptions };

export async function updateSession(request: NextRequest) {
  // Start with a pass-through response — we'll attach refreshed-cookie headers
  // to *this* response object as Supabase issues setAll calls.
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          // Mutate the incoming request's cookie store so downstream Server
          // Components see the refreshed cookies in their `cookies()` read.
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          // Re-create the response with the updated request cookies, then mirror
          // the cookies onto the outgoing Set-Cookie headers so the browser
          // persists them.
          supabaseResponse = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            supabaseResponse.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // CRITICAL: do NOT remove this call.
  // `getUser()` verifies the access token and, if it's expired, triggers
  // a refresh. The refresh result flows back through the `setAll` callback
  // above and lands on `supabaseResponse` for the browser.
  //
  // Putting any code between createServerClient and getUser() risks the
  // refresh not running before page rendering reads the (stale) session.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { supabaseResponse, user };
}
