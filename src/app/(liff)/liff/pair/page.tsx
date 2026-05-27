/**
 * /liff/pair — the LIFF webview's entry point.
 *
 * This is the LIFF Endpoint URL configured in LINE Developers Console.
 * Both first-time pairing AND returning-user flows funnel through here:
 *
 *   - Scenario A: First-time pairing
 *     Admin shares /i/<token> → employee scans on phone → /i/<token>
 *     redirects to liff.line.me/<liffId>?pair=<token> → LIFF webview opens
 *     this page with ?pair=<jwt>. We hand the token to PairClient which
 *     signs them into Supabase via LINE OIDC and binds the Employee row.
 *
 *   - Scenario B: Returning user (already paired)
 *     Employee taps the LINE rich menu button or a push-notification link
 *     → opens liff.line.me/<liffId> → LIFF webview loads this page WITHOUT
 *     ?pair=. If their Supabase session is still valid (cookie not
 *     expired), we bounce them straight to /liff/check-in. If not,
 *     they see the "ขอลิงก์ใหม่" message asking admin for a fresh link.
 *
 * Why this page is public (whitelisted in proxy.ts PUBLIC_INSIDE_PROTECTED):
 *   The pairing flow's whole point is to ESTABLISH the Supabase session.
 *   If the proxy required auth, it would 307 to /login and the LIFF
 *   handshake could never run. That was the bug that broke Scenario A
 *   when the endpoint URL was mistakenly pointed at /liff/check-in.
 */

import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { createClient } from '@/lib/supabase/server';
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
function extractPairToken(sp: Record<string, string | string[] | undefined>): string | null {
  // (1) Direct ?pair=<token>
  const rawPair = sp.pair;
  if (typeof rawPair === 'string' && rawPair.length > 0) return rawPair;

  // (2) liff.state — LIFF wraps a query/path inside this param. We expect
  //     "?pair=<token>". Parse it out.
  const rawState = sp['liff.state'];
  if (typeof rawState === 'string' && rawState.length > 0) {
    const stripped = rawState.startsWith('?') ? rawState.slice(1) : rawState;
    const inner = new URLSearchParams(stripped);
    const innerPair = inner.get('pair');
    if (innerPair && innerPair.length > 0) return innerPair;
  }

  return null;
}

export default async function LiffPairPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const pairingToken = extractPairToken(sp);

  // Scenario A: pair token present → run the binding client.
  if (pairingToken) {
    return <PairClient pairingToken={pairingToken} />;
  }

  // Scenario B: no token. If the user already has a Supabase session AND
  // a linked Employee row, send them straight to check-in. This is the
  // hot path for returning users tapping the LINE rich menu.
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (authUser) {
    const user = await prisma.user.findUnique({
      where: { authUserId: authUser.id },
      select: {
        archivedAt: true,
        employee: { select: { id: true } },
      },
    });
    if (user && !user.archivedAt && user.employee) {
      redirect('/liff/check-in');
    }
  }

  // No server-side token and no Supabase session. This is the LIFF
  // first-time-pair path: LIFF stripped `liff.state` from the URL before
  // forwarding to us (LIFF processes liff.state client-side, not on the
  // initial endpoint load). So we render PairClient with a null token;
  // PairClient runs liff.init() which rewrites the URL to include
  // ?pair=<token>, then extracts the token from window.location.
  //
  // For visitors arriving here OUTSIDE LIFF (no LINE context, no token),
  // PairClient's liff.init() will throw 'not-in-line' and the UI will
  // tell them to open the link in LINE — a better UX than the old
  // "ขาดลิงก์การจับคู่" terminal screen anyway.
  return <PairClient pairingToken={null} />;
}
