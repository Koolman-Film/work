/**
 * Server-side signed-URL generation for `attendance-photos` bucket.
 *
 * Used by admin review surfaces (e.g. the disputed-inbox panel) to
 * display employee-uploaded selfies. The bucket is private — direct
 * URLs would 401; signed URLs include a short-lived token and resolve
 * to the actual file bytes.
 *
 * We use the service-role (admin) client here, NOT the per-request
 * Supabase SSR client. Reasons:
 *   - The admin viewing this page may not have direct Storage RLS
 *     access (their JWT carries auth.uid() but no Storage policy
 *     grants admins read access to *all* folders by default — our
 *     RLS does, but via the SECURITY DEFINER `is_admin_or_owner`
 *     function, which is awkward to chain into createSignedUrl).
 *   - Service-role bypass is cleaner for read-only admin pages.
 *     The admin's role-gate at the *page* level (requireRole) is
 *     the authorization layer; Storage is just the data fetcher.
 *
 * Caller is responsible for ensuring the request is from an Admin —
 * which the admin route group's layout already guarantees via
 * requireRole(['Admin']).
 */

import { createClient } from '@supabase/supabase-js';

const URL_TTL_SECONDS = 60 * 10; // 10 minutes — enough for a review session

let adminClient: ReturnType<typeof createClient> | null = null;

function getAdminClient() {
  if (adminClient) return adminClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !serviceKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY');
  }
  adminClient = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return adminClient;
}

/**
 * Generate signed URLs for an array of storage keys in one batched call.
 * Returns a Map<key, signedUrl>; keys that fail to sign are absent
 * from the map (caller decides whether absence = "show broken image"
 * or "hide entirely").
 *
 * Why a batched API: signing 50 URLs one-by-one on every disputed-inbox
 * render would add ~500ms of latency. Supabase's createSignedUrls
 * (plural) handles it in one round-trip.
 */
export async function signAttendancePhotoUrls(
  keys: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  // Filter blanks/falsy upfront — Supabase rejects an empty path with
  // a confusing 400 if we don't.
  const unique = Array.from(new Set(keys.filter((k) => k && k.length > 0)));
  if (unique.length === 0) return out;

  const client = getAdminClient();
  const { data, error } = await client.storage
    .from('attendance-photos')
    .createSignedUrls(unique, URL_TTL_SECONDS);
  if (error) {
    console.error('[signed-urls] batch signing failed', error.message);
    return out;
  }

  for (const item of data ?? []) {
    if (item.signedUrl && item.path) {
      out.set(item.path, item.signedUrl);
    }
  }
  return out;
}

/**
 * Detect whether a stored "URL"-ish string is actually a Storage key
 * (path within the bucket) or a fully-qualified external URL.
 *
 * Returns the input untouched if it looks like a URL (http/https), or
 * a Promise of the signed URL if it looks like a storage key.
 *
 * Why a runtime sniff: `Attendance.checkInSelfieUrl` and
 * `CashAdvance.receiptUrl` are both `String?` columns and the schema
 * doesn't distinguish. We chose to store paths post-W4-late, but old
 * rows (or admin-pasted Drive links from before A2) may be URLs.
 * Sniffing keeps the view layer simple: pass either kind in, get a
 * displayable URL out.
 */
export async function resolveStoredImageUrl(value: string | null): Promise<string | null> {
  if (!value) return null;
  // Anything starting with a scheme is a URL — pass through.
  if (/^https?:\/\//i.test(value)) return value;
  // Otherwise treat as a storage key.
  const signed = await signAttendancePhotoUrls([value]);
  return signed.get(value) ?? null;
}
