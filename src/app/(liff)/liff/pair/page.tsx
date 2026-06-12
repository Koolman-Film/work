/**
 * /liff/pair — the LIFF webview's entry point.
 *
 * Configured as the LIFF Endpoint URL in LINE Developers Console.
 * All LIFF flows funnel through here:
 *
 *   - Scenario A: First-time pairing
 *     Admin shares /i/<token> → employee scans on phone → /i/<token>
 *     redirects to liff.line.me/<liffId>?liff.state=?pair=<token>. LIFF
 *     strips liff.state on the server hit (it's processed client-side
 *     in PairClient via liff.init()).
 *
 *   - Scenario B: Returning user — daily check-in via rich menu / push
 *     Employee taps "เช็คอิน" rich menu → liff.line.me/<liffId>
 *     → loads /liff/pair → PairClient → liffBootstrap (warm session) →
 *     redirect /liff/check-in.
 *
 *   - Scenario C: Returning user — rich menu deep link to leave/advance/
 *     calendar etc. Rich menu URL: liff.line.me/<liffId>?liff.state=?dest=leave
 *     → PairClient sees ?dest=leave after liff.init() → redirect /liff/leave.
 *
 * Why we render PairClient unconditionally (no server-side fast-redirect):
 *   LIFF strips both query strings and path segments before forwarding to
 *   our endpoint. The destination hint (`?dest=`) only becomes visible
 *   AFTER `liff.init()` runs client-side and rewrites window.location.
 *   If we redirected server-side based on auth state alone, every rich
 *   menu deep link would lose its hint and land on /liff/check-in.
 *
 * Why this page is public (whitelisted in proxy.ts PUBLIC_INSIDE_PROTECTED):
 *   The pairing flow's whole point is to ESTABLISH the Supabase session.
 *   If the proxy required auth, it would 307 to /login and the LIFF
 *   handshake could never run.
 */

import PairClient from './pair-client';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Extract the pair token from the request searchParams.
 *
 * Tries three sources in order — pragmatic because each LIFF/LINE
 * combination delivers the token differently in the wild:
 *
 *   1. `?pair=<token>` — what we'd hope for; the raw query form
 *   2. `?liff.state=<urlencoded(?pair=<token>)>` — LIFF's official state
 *      mechanism. This is what /i/[token] now generates; the server sees
 *      this on FIRST render before LIFF SDK rewrites the URL client-side.
 *   3. (See also /liff/pair/[token]/page.tsx for the path-based fallback.)
 *
 * Returns null if no token can be extracted from any source.
 */
function extractToken(
  sp: Record<string, string | string[] | undefined>,
  key: 'pair' | 'pairAdmin',
): string | null {
  // (1) Direct ?pair=<token> / ?pairAdmin=<token>
  const raw = sp[key];
  if (typeof raw === 'string' && raw.length > 0) return raw;

  // (2) liff.state — LIFF wraps a query/path inside this param. We expect
  //     "?pair=<token>" or "?pairAdmin=<token>". Parse it out.
  const rawState = sp['liff.state'];
  if (typeof rawState === 'string' && rawState.length > 0) {
    const stripped = rawState.startsWith('?') ? rawState.slice(1) : rawState;
    const inner = new URLSearchParams(stripped);
    const innerToken = inner.get(key);
    if (innerToken && innerToken.length > 0) return innerToken;
  }

  return null;
}

export default async function LiffPairPage({ searchParams }: { searchParams: SearchParams }) {
  // We DO still parse the server-visible query params — this is the
  // fast path for the rare case where LIFF actually preserves the raw
  // query (some LINE versions / non-LIFF dev tests). If we get a token
  // server-side, PairClient skips its window.location.search lookup.
  // No server-side auth check or redirect: everything routes through
  // PairClient client-side so `?dest=` from liff.state can be honored.
  const sp = await searchParams;
  const pairingToken = extractToken(sp, 'pair');
  const adminPairingToken = extractToken(sp, 'pairAdmin');

  return <PairClient pairingToken={pairingToken} adminPairingToken={adminPairingToken} />;
}
