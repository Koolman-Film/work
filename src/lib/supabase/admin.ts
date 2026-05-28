/**
 * Service-role (admin) Supabase client.
 *
 * Use this client when you need to bypass RLS or call admin-only auth
 * APIs (`auth.admin.createUser`, `auth.admin.updateUserById`,
 * `auth.admin.listUsers`, etc). The service-role key in env is the only
 * thing standing between this client and the entire database; treat
 * every call site as a potential privilege escalation and verify the
 * caller has gone through `requireRole(['Admin'])` or `['Superadmin']` first.
 *
 * The client is memoized at module scope — Supabase JS SDK clients are
 * cheap, but holding one open avoids the small TLS-handshake hit on
 * every Server Action call.
 *
 * NEVER export this client to the browser. It's gated behind a server-
 * only import path (`@/lib/supabase/admin`) and any module that imports
 * it should be a Server Component / Server Action / route handler.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

export function getSupabaseAdminClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY — service-role client unavailable',
    );
  }

  cached = createClient(url, serviceKey, {
    // Service-role tokens are static; we never want the SDK trying to
    // refresh them or persist them across requests.
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cached;
}
