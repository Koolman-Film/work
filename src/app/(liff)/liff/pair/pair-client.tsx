'use client';

/**
 * Client orchestrator for the LIFF entry point (`/liff/pair`).
 *
 * Handles THREE flows depending on what's in the URL after liff.init()
 * rewrites it from `?liff.state=...`:
 *
 *   1. BINDING — `?pair=<jwt>` present (first-time pairing)
 *        liffBootstrap → linkLineToEmployee → redirect to dest or check-in
 *
 *   2. DISPATCH — `?dest=<slug>` present (rich menu deep link, already paired)
 *        liffBootstrap (session is usually warm) → redirect to /liff/<slug>
 *        Slug MUST be in DEST_WHITELIST — otherwise it's ignored and we
 *        fall through to default. This prevents open-redirect attacks.
 *
 *   3. DEFAULT — neither (returning user opened LIFF with no extra state)
 *        liffBootstrap → redirect to /liff/check-in
 *
 * Lifecycle (single useEffect, runs once on mount):
 *   ┌────────────────────────────────────────────────────────────────┐
 *   │ 1. liffBootstrap()                                              │
 *   │      ├─ liff.init({ liffId })  ←  processes ?liff.state= and    │
 *   │      │                            rewrites window.location.     │
 *   │      ├─ supabase.auth.getSession()  (fast-path if already in)   │
 *   │      ├─ liff.getIDToken()                                       │
 *   │      └─ supabase.auth.signInWithIdToken('custom:line')          │
 *   │ 2. Inspect window.location.search for ?pair / ?dest             │
 *   │ 3. Branch: BINDING / DISPATCH / DEFAULT  (described above)      │
 *   │ 4. window.location.href = <next page>                           │
 *   └────────────────────────────────────────────────────────────────┘
 *
 * Why the redirect uses window.location instead of next/navigation
 * `router.push`:
 *   - We need a full page-load so the proxy's session refresh runs and
 *     the new Supabase cookies are present when the destination page's
 *     `requireRole(['Employee'])` reads them. A client-side router.push
 *     would race the cookie write.
 */

import { useEffect, useState } from 'react';
import { type LinkLineResult, linkLineToEmployee } from '@/lib/auth/link-line-to-employee';
import { type LiffBootstrapError, liffBootstrap } from '@/lib/liff/init';

/**
 * Allowed `?dest=<slug>` values for the dispatch flow.
 *
 * These map 1:1 onto LIFF route folders under `src/app/(liff)/liff/`.
 * Anything not in this set is silently rejected (we fall through to the
 * check-in default) — never use the raw `?dest=` value as a path
 * directly, or attackers can redirect employees to arbitrary URLs by
 * crafting links like `?dest=../../external-phishing-site`.
 *
 * Add new slugs here when you add new LIFF pages users should be able
 * to deep-link to from the rich menu.
 */
const DEST_WHITELIST = new Set(['check-in', 'leave', 'advance', 'calendar', 'profile']);
const DEFAULT_DEST = '/liff/check-in';

/**
 * LINE Add-Friend deep link for the Koolman Work Messaging API OA.
 *
 * Used as the post-binding redirect for first-time pair completion —
 * after a new employee successfully links their LINE account to their
 * Employee row, we send them here so they add the OA as a friend. Why
 * it matters:
 *   - LINE push notifications (leave approved, advance approved, etc.)
 *     only deliver if the recipient is friends with the OA. Silently
 *     drop otherwise — so a non-friend employee never receives any
 *     notifications. Forcing friend-add at the END of pairing makes
 *     every new account fully wired up before they start daily use.
 *   - LINE's rich menu (the tile bar at the bottom of the chat) only
 *     appears when you're friends. Without it, employees would have to
 *     bookmark / re-type LIFF URLs every day.
 *
 * Behavior on returning users (already friends with the OA): LINE opens
 * the existing chat directly instead of showing the add-friend dialog.
 * So this URL is safe to redirect to even when re-running the pair flow.
 *
 * Basic ID format `@<id>` is URL-encoded to `%40<id>` for the path.
 * (Hardcoded for V1; could be moved to NEXT_PUBLIC_LINE_OA_BASIC_ID
 * env var if multiple OAs ever need to coexist.)
 */
const OA_BASIC_ID = '@994gaezx';
const ADD_FRIEND_URL = `https://line.me/R/ti/p/${encodeURIComponent(OA_BASIC_ID)}`;

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
        // is what makes the next steps (resolving ?pair / ?dest) work for
        // the LIFF-launched case — the server couldn't see liff.state,
        // but after init() runs client-side, the unwrapped query is in
        // the URL.
        await liffBootstrap();
        if (cancelled) return;

        // Step 3: resolve token + destination from the rewritten URL.
        // Source precedence for the pair token:
        //   (a) Prop from server — set when the server saw ?pair= or
        //       ?liff.state= on the initial request (non-LIFF dev test).
        //   (b) window.location.search after liff.init() — the LIFF case.
        let resolvedToken = pairingToken;
        let destSlug: string | null = null;
        if (typeof window !== 'undefined') {
          const sp = new URLSearchParams(window.location.search);
          if (!resolvedToken) resolvedToken = sp.get('pair');
          destSlug = sp.get('dest');
        }

        // Whitelist the destination slug — never use raw `?dest=` in a
        // redirect target. Anything not on the allowlist falls back to
        // the default (check-in).
        const destPath =
          destSlug && DEST_WHITELIST.has(destSlug) ? `/liff/${destSlug}` : DEFAULT_DEST;

        // ── Branch A: BINDING flow (first-time pair) ─────────────────
        if (resolvedToken) {
          setState({ phase: 'linking', message: 'กำลังเชื่อมบัญชีกับ Koolman Work...' });
          const result: LinkLineResult = await linkLineToEmployee({
            pairingToken: resolvedToken,
          });
          if (cancelled) return;

          if (result.ok) {
            setState({
              phase: 'success',
              employeeName: `${result.employee.firstName} ${result.employee.lastName}`.trim(),
            });
            // For first-time pairing we redirect to the LINE Add-Friend page
            // for the Koolman Work OA, NOT to /liff/check-in. Reasoning:
            //   - Push notifications fail silently if the user isn't friends
            //     with the OA. Forcing the friend-add at the end of pair
            //     ensures every account is fully wired before daily use.
            //   - Already-friend users land directly in the chat (LINE
            //     handles that case gracefully), so re-running pair is safe.
            //   - The `destPath` from rich-menu dispatch (?dest=) doesn't
            //     apply here — first-time pair URLs come from admin QR /
            //     /i/[token] redirects, which never carry ?dest. The hint
            //     IS still honored in the dispatch (no-token) branch below.
            setTimeout(() => {
              window.location.href = ADD_FRIEND_URL;
            }, 1500);
          } else {
            setState({
              phase: 'error',
              message: result.message,
              // Retry only makes sense for transient classes; consumed/
              // expired tokens are terminal until admin re-issues.
              canRetry: false,
            });
          }
          return;
        }

        // ── Branch B: DISPATCH / DEFAULT ─────────────────────────────
        // liffBootstrap succeeded → user is authed. Just navigate.
        // No "success" UI — they shouldn't dwell here; the destination
        // page handles the rest.
        setState({ phase: 'linking', message: 'กำลังโหลด...' });
        window.location.href = destPath;
        return;
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
      <p className="text-xs text-gray-500">ขั้นตอนสุดท้าย: เพิ่มเพื่อน Koolman Work เพื่อรับการแจ้งเตือน</p>
      <p className="text-xs text-gray-400">กำลังพาคุณไปหน้าเพิ่มเพื่อน...</p>
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
