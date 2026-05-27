'use client';

/**
 * Client orchestrator for the LIFF pairing flow.
 *
 * Lifecycle (single useEffect, runs once on mount):
 *   ┌────────────────────────────────────────────────────────────────┐
 *   │ 1. liffBootstrap()                                              │
 *   │      ├─ liff.init({ liffId })                                   │
 *   │      ├─ supabase.auth.getSession()  (fast-path if already in)   │
 *   │      ├─ liff.getIDToken()                                       │
 *   │      └─ supabase.auth.signInWithIdToken('custom:line')          │
 *   │ 2. linkLineToEmployee({ pairingToken })  (Server Action)        │
 *   │      ├─ verifyPairingToken  (JWT)                               │
 *   │      └─ atomic User+Employee bind + audit                       │
 *   │ 3. On success: show "เชื่อมสำเร็จ" → redirect /liff/check-in    │
 *   │    On failure: show Thai message + "ติดต่อแอดมิน" CTA           │
 *   └────────────────────────────────────────────────────────────────┘
 *
 * Why the redirect uses window.location instead of next/navigation
 * `router.push`:
 *   - We need a full page-load to /liff/check-in so the proxy's session
 *     refresh runs and the new Supabase cookies are present when the
 *     destination page's `requireRole(['Employee'])` reads them. A
 *     client-side router.push would race the cookie write.
 */

import { useEffect, useState } from 'react';
import { type LinkLineResult, linkLineToEmployee } from '@/lib/auth/link-line-to-employee';
import { type LiffBootstrapError, liffBootstrap } from '@/lib/liff/init';

type PhaseState =
  | { phase: 'booting'; message: string }
  | { phase: 'signing-in'; message: string }
  | { phase: 'linking'; message: string }
  | { phase: 'success'; employeeName: string }
  | { phase: 'error'; message: string; canRetry: boolean };

export default function PairClient({ pairingToken }: { pairingToken: string | null }) {
  const [state, setState] = useState<PhaseState>({
    phase: 'booting',
    message: 'กำลังเตรียมการเชื่อมต่อกับ LINE...',
  });

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        if (cancelled) return;
        setState({ phase: 'signing-in', message: 'กำลังเข้าสู่ระบบด้วย LINE...' });

        // Step 1+2: liff.init + signInWithIdToken.
        // Side effect: liff.init() processes any `?liff.state=` in the
        // URL and rewrites window.location via history.replaceState. This
        // is what makes the next step (resolving the token) work for the
        // LIFF-launched case — the server couldn't see liff.state, but
        // after init() runs client-side, ?pair=<token> is in the URL.
        await liffBootstrap();
        if (cancelled) return;

        // Step 3: resolve the pair token.
        // Source precedence:
        //   (a) Prop from server — set when the server saw ?pair= or
        //       ?liff.state= on the initial request (e.g. non-LIFF dev test).
        //   (b) window.location.search after liff.init() — the LIFF case.
        //       LIFF SDK unwraps `?liff.state=?pair=<token>` into
        //       `?pair=<token>` on the live URL via history.replaceState.
        let resolvedToken = pairingToken;
        if (!resolvedToken && typeof window !== 'undefined') {
          const sp = new URLSearchParams(window.location.search);
          resolvedToken = sp.get('pair');
        }

        if (!resolvedToken) {
          setState({
            phase: 'error',
            message: 'ขาดลิงก์การจับคู่ — กรุณาเปิดลิงก์ที่แอดมินส่งให้คุณอีกครั้ง',
            canRetry: false,
          });
          return;
        }

        // Step 4: bind on the server
        setState({ phase: 'linking', message: 'กำลังเชื่อมบัญชีกับ Koolman Work...' });
        const result: LinkLineResult = await linkLineToEmployee({ pairingToken: resolvedToken });
        if (cancelled) return;

        if (result.ok) {
          setState({
            phase: 'success',
            employeeName: `${result.employee.firstName} ${result.employee.lastName}`.trim(),
          });
          // Full page-load to ensure cookies propagate before requireRole.
          setTimeout(() => {
            window.location.href = '/liff/check-in';
          }, 1500);
        } else {
          setState({
            phase: 'error',
            message: result.message,
            // Retry only makes sense for transient classes; consumed/expired
            // tokens are terminal until admin re-issues.
            canRetry: false,
          });
        }
      } catch (err) {
        if (cancelled) return;
        const e = err as LiffBootstrapError;
        const message =
          e?.kind === 'not-in-line'
            ? 'กรุณาเปิดลิงก์นี้ภายในแอป LINE'
            : e?.kind === 'no-id-token'
              ? 'LINE ไม่ส่งข้อมูลยืนยันตัวตน กรุณาลองอีกครั้ง'
              : e?.kind === 'supabase-rejected'
                ? 'ระบบยืนยันตัวตนปฏิเสธ — โปรดติดต่อแอดมิน'
                : e?.kind === 'misconfigured'
                  ? 'ระบบยังตั้งค่าไม่สมบูรณ์ — โปรดติดต่อแอดมิน'
                  : 'ไม่สามารถเชื่อมต่อ LINE ได้';
        setState({ phase: 'error', message, canRetry: e?.kind === 'no-id-token' });
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [pairingToken]);

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-12">
      <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <p className="text-center text-sm text-gray-500">Koolman Work</p>
        <h1 className="mt-1 text-center text-xl font-semibold text-gray-900">เชื่อมบัญชี LINE</h1>

        <div className="mt-6">
          {state.phase === 'booting' ||
          state.phase === 'signing-in' ||
          state.phase === 'linking' ? (
            <ProgressBlock label={state.message} />
          ) : state.phase === 'success' ? (
            <SuccessBlock employeeName={state.employeeName} />
          ) : (
            <ErrorBlock message={state.message} canRetry={state.canRetry} />
          )}
        </div>
      </div>
    </div>
  );
}

function ProgressBlock({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <Spinner />
      <p className="text-sm text-gray-600">{label}</p>
    </div>
  );
}

function SuccessBlock({ employeeName }: { employeeName: string }) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-full bg-green-100 text-green-700">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-6 w-6"
          aria-hidden="true"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <p className="text-base font-medium text-gray-900">เชื่อมบัญชีสำเร็จ</p>
      <p className="text-sm text-gray-600">ยินดีต้อนรับ, {employeeName}</p>
      <p className="text-xs text-gray-400">กำลังพาคุณไปหน้าเช็คอิน...</p>
    </div>
  );
}

function ErrorBlock({ message, canRetry }: { message: string; canRetry: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-full bg-red-100 text-red-700">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-6 w-6"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <p className="text-base font-medium text-gray-900">ไม่สามารถเชื่อมบัญชีได้</p>
      <p className="text-sm text-gray-600">{message}</p>
      {canRetry && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-2 rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700"
        >
          ลองอีกครั้ง
        </button>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="h-8 w-8 animate-spin text-primary-600"
      viewBox="0 0 24 24"
      fill="none"
      aria-label="Loading"
      role="img"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path
        d="M22 12a10 10 0 0 0-10-10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
