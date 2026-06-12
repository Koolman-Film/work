/**
 * /liff/pair-admin/[token] — admin self-serve LINE pairing entry.
 *
 * Admin mints the link on /admin/settings/line and opens it on their phone
 * inside LINE. The token rides as a path segment (same reliability rationale
 * as /liff/pair/[token] — path segments survive LIFF forwarding where query
 * strings sometimes don't).
 */

import PairAdminClient from './pair-admin-client';

type Params = Promise<{ token: string }>;

export default async function LiffPairAdminPage({ params }: { params: Params }) {
  const { token } = await params;
  return <PairAdminClient pairingToken={token} />;
}
