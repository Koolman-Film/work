/**
 * /liff/pair/[token] — path-based pairing entry.
 *
 * Why this exists alongside /liff/pair (which reads `?pair=` query):
 *   LIFF's documented behavior says it preserves query strings when
 *   forwarding from liff.line.me/<id>?foo=bar to the endpoint URL.
 *   In practice, older LINE app versions + certain Android WebView
 *   builds STRIP query strings, leaving the endpoint with no token.
 *
 *   The path portion of a LIFF URL (everything after liffId/) is
 *   preserved with 100% reliability — it's just appended to the
 *   endpoint URL. So passing the token as a path segment instead of
 *   a query parameter sidesteps the query-stripping bug entirely.
 *
 * Flow:
 *   /i/[token]/page.tsx redirects in-LINE visitors to:
 *     liff.line.me/<liffId>/<token>
 *   With endpoint URL = https://work.kool-man.com/liff/pair, the
 *   resulting URL is /liff/pair/<token>, which this dynamic route
 *   handles.
 *
 * The page just renders PairClient with the token from the path —
 * same binding flow as the query-based fallback in ../page.tsx.
 */

import PairClient from '../pair-client';

type Params = Promise<{ token: string }>;

export default async function LiffPairWithTokenPage({ params }: { params: Params }) {
  const { token } = await params;
  // Dynamic route guarantees token is present and non-empty.
  return <PairClient pairingToken={token} />;
}
