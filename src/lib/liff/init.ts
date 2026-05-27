/**
 * LIFF bootstrap — client-side init + Supabase OIDC sign-in handshake.
 *
 * This is THE place where a LINE user becomes a Supabase-authenticated user:
 *
 *   1. `liff.init({ liffId })` — fetches the channel config from LINE,
 *      and inside the LINE in-app browser hydrates `liff.getIDToken()`.
 *   2. If LIFF is OK but the user hasn't authorized us yet in this LINE
 *      session, `liff.login()` redirects them to LINE consent (rare for
 *      shared-channel LIFF apps but possible on first run from a fresh
 *      external browser).
 *   3. Read the LINE-issued OIDC ID token via `liff.getIDToken()`.
 *   4. Hand it to Supabase via `signInWithIdToken({ provider: 'custom:line' })`.
 *      Supabase verifies the LINE OIDC JWKS, then mints its own access /
 *      refresh tokens and writes the auth.users row (id = stable Supabase
 *      UUID, providers.line.sub = LINE userId).
 *
 * Idempotency:
 *   - We check `supabase.auth.getSession()` first. If there's already a live
 *     Supabase session, we skip the whole LINE handshake and return early.
 *     This matters because LIFF re-runs init on every page nav in the LIFF
 *     stack; without the guard we'd burn quota and confuse the auth state.
 *
 * Failure modes the caller has to handle:
 *   - `liff.init()` rejects: most often because the user opened the URL
 *     in a regular browser instead of LINE (LIFF works in some web
 *     contexts but not all). Render an "open in LINE" prompt.
 *   - `liff.getIDToken()` returns null: LINE didn't issue one (channel mis-
 *     config, or the user is still logged out of LINE). `liff.login()`
 *     forces a redirect-based re-auth.
 *   - `signInWithIdToken` rejects: Supabase couldn't verify the LINE token.
 *     Usually means the channel ID in Supabase doesn't match the channel
 *     that issued the token. Surface the error and stop — never silently
 *     fall back to anonymous auth.
 */

'use client';

import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/browser';

export type LiffBootstrapResult = {
  supabase: SupabaseClient;
  session: Session;
  /** Stable LINE user-id (the `sub` claim from LINE's OIDC token). */
  lineUserId: string;
};

export type LiffBootstrapError =
  | { kind: 'not-in-line'; message: string }
  | { kind: 'no-id-token'; message: string }
  | { kind: 'supabase-rejected'; message: string }
  | { kind: 'misconfigured'; message: string };

/**
 * Run on mount in a LIFF Client Component. Resolves with `{ supabase, session,
 * lineUserId }` once the user is authenticated to Supabase via LINE OIDC,
 * OR throws a `LiffBootstrapError` describing what blocked the handshake.
 */
export async function liffBootstrap(): Promise<LiffBootstrapResult> {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  if (!liffId) {
    throw {
      kind: 'misconfigured',
      message: 'NEXT_PUBLIC_LIFF_ID is not set — admin must configure deploy env',
    } satisfies LiffBootstrapError;
  }

  // Dynamic import: @line/liff is a browser-only package and importing it
  // from any module that gets evaluated at SSR build time blows up Next.
  const liff = (await import('@line/liff')).default;

  try {
    await liff.init({ liffId });
  } catch (err) {
    throw {
      kind: 'not-in-line',
      message:
        err instanceof Error
          ? err.message
          : 'LIFF failed to initialize — open this link inside the LINE app',
    } satisfies LiffBootstrapError;
  }

  const supabase = createClient();

  // Fast path: already signed in to Supabase from a prior LIFF nav.
  const { data: existing } = await supabase.auth.getSession();
  if (existing.session) {
    const lineUserId = (existing.session.user.identities ?? []).find(
      (i) => i.provider === 'custom:line',
    )?.id;
    return {
      supabase,
      session: existing.session,
      // Fall back to user.id if the identities array isn't populated (some
      // Supabase responses omit it on token refresh).
      lineUserId: lineUserId ?? existing.session.user.id,
    };
  }

  // Need a fresh Supabase session. Demand a LINE ID token first.
  if (!liff.isLoggedIn()) {
    // Triggers a redirect to LINE auth — execution effectively stops here.
    // When the user returns, this function will run again from the top.
    liff.login({ redirectUri: window.location.href });
    // The promise never resolves on the redirecting tab; throwing keeps
    // the type-system honest in case `liff.login` returns instead.
    throw {
      kind: 'no-id-token',
      message: 'Redirecting to LINE login...',
    } satisfies LiffBootstrapError;
  }

  const idToken = liff.getIDToken();
  if (!idToken) {
    throw {
      kind: 'no-id-token',
      message: 'LINE did not issue an ID token — check that openid scope is enabled on the channel',
    } satisfies LiffBootstrapError;
  }

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'custom:line',
    token: idToken,
  });

  if (error || !data.session) {
    throw {
      kind: 'supabase-rejected',
      message: error?.message ?? 'Supabase rejected the LINE ID token',
    } satisfies LiffBootstrapError;
  }

  // The LINE sub is the most reliable source of truth — pull it from the
  // identities Supabase attached, falling back to the LIFF SDK.
  const lineUserId =
    (data.session.user.identities ?? []).find((i) => i.provider === 'custom:line')?.id ??
    liff.getDecodedIDToken()?.sub ??
    data.session.user.id;

  return { supabase, session: data.session, lineUserId };
}
