/**
 * /liff/pair — LIFF entry page that binds a LINE user to an Employee.
 *
 * URL shape:  /liff/pair?pair=<jwt>
 *
 * The LIFF redirect from /i/[token] always carries `?pair=<jwt>`. If the
 * query parameter is missing, the user arrived in some unusual way
 * (bookmarked the LIFF URL directly?). We render a friendly "ขอลิงก์ใหม่"
 * page rather than crashing.
 *
 * This is a Server Component because:
 *   - Reading `searchParams` server-side avoids a Client-Component-only
 *     `useSearchParams()` dance, which would otherwise require Suspense
 *     boundaries in Next 16.
 *   - The actual LIFF SDK work (init, signInWithIdToken, fetch) lives in
 *     the Client child below — we just hand it the validated token string.
 */

import PairClient from './pair-client';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function LiffPairPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const raw = sp.pair;
  const pairingToken = typeof raw === 'string' && raw.length > 0 ? raw : null;

  if (!pairingToken) {
    return (
      <div className="grid min-h-dvh place-items-center px-4 py-12">
        <div className="w-full max-w-sm space-y-3 rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <p className="text-sm text-gray-500">Koolman HR</p>
          <h1 className="text-xl font-semibold text-gray-900">ขาดลิงก์การจับคู่</h1>
          <p className="text-sm text-gray-600">
            กรุณาเปิดลิงก์จับคู่ที่แอดมินส่งให้คุณอีกครั้ง หรือติดต่อแอดมินเพื่อขอลิงก์ใหม่
          </p>
        </div>
      </div>
    );
  }

  return <PairClient pairingToken={pairingToken} />;
}
