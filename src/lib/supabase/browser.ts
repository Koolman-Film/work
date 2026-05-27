/**
 * Browser-side Supabase client.
 *
 * Use this in Client Components (`'use client'` files). Cookies are read
 * and written through `document.cookie` directly by Supabase's internals
 * — no setup needed beyond the URL + anon key.
 *
 * Safe to instantiate per-component; Supabase caches the underlying auth
 * state at module level, so repeated calls share session.
 */

import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
