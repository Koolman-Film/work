/**
 * Server-side Supabase client.
 *
 * Use this in:
 *   - Server Components (`async function Page()`)
 *   - Server Actions (`'use server'` modules)
 *   - Route Handlers (`app/.../route.ts`)
 *
 * Creates a **new client per request** — never share across requests.
 * Cookie writes happen through Next's `cookies()` API. When called outside
 * middleware (e.g. during a Server Component render), `setAll` may be a
 * no-op because Next doesn't allow Set-Cookie at render time — this is
 * fine because middleware.ts refreshes the session and writes cookies on
 * every request before Server Components render.
 *
 * Reference: https://github.com/supabase/ssr (createServerClient + Next.js)
 */

import { type CookieOptions, createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

type CookieToSet = { name: string; value: string; options?: CookieOptions };

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component — cookies() is read-only there.
            // That's OK because middleware.ts refreshes sessions on every
            // request before any Server Component renders.
          }
        },
      },
    },
  );
}
