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
 *   2. ADMIN BINDING — `?pairAdmin=<jwt>` present
 *        liffBootstrap → linkLineToAdmin → redirect to OA add-friend
 *
 *   3. MERGE — `?merge=<jwt>` present (pure-admin scans merge QR)
 *        liffBootstrap → validate JWT shape → redirect to /liff/merge/<token>
 *        Token MUST be a compact JWT (three base64url segments) — otherwise
 *        fall through to default. This prevents path-injection attacks.
 *
 *   4. DISPATCH — `?dest=<slug>` present (rich menu deep link, already paired)
 *        liffBootstrap (session is usually warm) → redirect to /liff/<slug>
 *        Slug MUST be in DEST_WHITELIST — otherwise it's ignored and we
 *        fall through to default. This prevents open-redirect attacks.
 *
 *   5. DEFAULT — none of the above (returning user opened LIFF with no extra state)
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
 *   │ 2. Inspect window.location.search for ?pair / ?pairAdmin / ?merge / ?dest │
 *   │ 3. Branch: BINDING / DISPATCH / DEFAULT  (described above)      │
 *   │ 4. window.location.href = <next page>                           │
 *   └────────────────────────────────────────────────────────────────┘
 *
 * Why the redirect uses window.location instead of next/navigation
 * `router.push`:
 *   - We need a full page-load so the proxy's session refresh runs and
 *     the new Supabase cookies are present when the destination page's
 *     `requireRole(['Staff'])` reads them. A client-side router.push
 *     would race the cookie write.
 */

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { linkLineToAdmin } from '@/lib/auth/link-line-to-admin';
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
const DEST_MAP: Record<string, string> = {
  'check-in': '/liff/check-in',
  leave: '/liff/leave',
  advance: '/liff/advance',
  calendar: '/liff/calendar',
  profile: '/liff/profile',
  // Admin LIFF pages MUST be entered through this funnel: the LIFF
  // browser (where the session lives) and LINE's plain in-app browser
  // have separate cookie jars, so a direct app URL opens sessionless
  // and the gate's external-browser login can't complete. The admin
  // rich menu + admin push buttons all use ?dest= for this reason.
  'admin-inbox': '/liff/admin/inbox',
  'admin-advance': '/liff/admin/advance',
  'admin-advance-slip': '/liff/admin/advance',
  'admin-dashboard': '/liff/admin/dashboard',
  'admin-reports': '/liff/admin/reports',
};

/** Parametrized admin dests — `?dest=<slug>&id=<uuid>`. The id is
 *  validated as a UUID before being placed in a path (same open-redirect
 *  caution as DEST_MAP: never interpolate raw query values). */
const PARAM_DEST_MAP: Record<string, (id: string) => string> = {
  'admin-leave-detail': (id) => `/liff/admin/leave/${id}`,
  'admin-advance-detail': (id) => `/liff/admin/advance/${id}`,
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `?m=YYYY-MM` for the payslip dest — validated before going in the path
 *  (same open-redirect caution as the maps above). */
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
/**
 * Compact-JWT shape: exactly three base64url segments separated by dots.
 * Used to validate ?merge= before building a path from it — prevents
 * path-injection like `?merge=../../evil`.
 */
const COMPACT_JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
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
  | { phase: 'admin-success' }
  | { phase: 'error'; message: string; canRetry: boolean };

export default function PairClient({
  pairingToken,
  adminPairingToken = null,
}: {
  pairingToken: string | null;
  adminPairingToken?: string | null;
}) {
  const t = useTranslations('pair');
  const [state, setState] = useState<PhaseState>(() => ({
    phase: 'booting',
    message: t('phase.preparing'),
  }));

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        if (cancelled) return;
        setState({ phase: 'signing-in', message: t('phase.signingIn') });

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
        let resolvedAdminToken = adminPairingToken;
        let mergeToken: string | null = null;
        let destSlug: string | null = null;
        let destId: string | null = null;
        let destMonth: string | null = null;
        if (typeof window !== 'undefined') {
          const sp = new URLSearchParams(window.location.search);
          if (!resolvedToken) resolvedToken = sp.get('pair');
          if (!resolvedAdminToken) resolvedAdminToken = sp.get('pairAdmin');
          mergeToken = sp.get('merge');
          destSlug = sp.get('dest');
          destId = sp.get('id');
          destMonth = sp.get('m');
        }

        // Map the destination slug — never use raw `?dest=` in a
        // redirect target. Anything not in the maps falls back to
        // the default (check-in). Parametrized dests require a UUID id;
        // the payslip dest takes a validated `?m=YYYY-MM` instead.
        let destPath = DEFAULT_DEST;
        const mapped = destSlug ? DEST_MAP[destSlug] : undefined;
        const mappedParam = destSlug ? PARAM_DEST_MAP[destSlug] : undefined;
        if (mapped) {
          destPath = mapped;
        } else if (mappedParam && destId && UUID_RE.test(destId)) {
          destPath = mappedParam(destId);
        } else if (destSlug === 'payslip') {
          destPath =
            destMonth && MONTH_RE.test(destMonth)
              ? `/liff/payslip?m=${destMonth}`
              : '/liff/payslip';
        }

        // ── Branch A0: ADMIN BINDING flow (?pairAdmin=) ──────────────
        // Same funnel as worker pairing, different bind action. Admin-
        // facing → Thai literals (matches the untranslated admin panel).
        // After binding we ALSO send admins to the OA add-friend page:
        // pushes + the admin rich menu only work for OA friends.
        if (resolvedAdminToken) {
          setState({ phase: 'linking', message: 'กำลังเชื่อมต่อบัญชีแอดมิน...' });
          const adminResult = await linkLineToAdmin({ pairingToken: resolvedAdminToken });
          if (cancelled) return;

          if (adminResult.ok) {
            setState({ phase: 'admin-success' });
            setTimeout(() => {
              window.location.href = ADD_FRIEND_URL;
            }, 1500);
          } else {
            setState({ phase: 'error', message: adminResult.message, canRetry: false });
          }
          return;
        }

        // ── Branch A1: MERGE flow (?merge=<jwt>) ─────────────────────
        // Triggered when a pure admin scans the merge QR issued by
        // startAdminMerge. After liff.init() unwraps ?liff.state=?merge=<token>
        // we hand off to the already-built MergeClient at /liff/merge/[token].
        //
        // SECURITY: validate the token is a compact JWT (three base64url
        // segments) before placing it in a URL path. Without this guard an
        // attacker could craft ?merge=../../evil and path-inject.
        if (mergeToken) {
          if (COMPACT_JWT_RE.test(mergeToken)) {
            // Valid compact JWT — hand off to the merge confirmation page.
            window.location.assign(`/liff/merge/${encodeURIComponent(mergeToken)}`);
            return;
          }
          // Invalid shape — fall through to default (check-in) silently,
          // same as an unrecognised ?dest slug.
        }

        // ── Branch A: BINDING flow (first-time pair) ─────────────────
        if (resolvedToken) {
          setState({ phase: 'linking', message: t('phase.linking') });
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
        setState({ phase: 'linking', message: t('phase.loading') });
        window.location.href = destPath;
        return;
      } catch (err) {
        if (cancelled) return;
        const e = err as LiffBootstrapError;
        const message =
          e?.kind === 'not-in-line'
            ? t('error.notInLine')
            : e?.kind === 'no-id-token'
              ? t('error.noIdToken')
              : e?.kind === 'supabase-rejected'
                ? t('error.supabaseRejected')
                : e?.kind === 'misconfigured'
                  ? t('error.misconfigured')
                  : t('error.generic');
        setState({ phase: 'error', message, canRetry: e?.kind === 'no-id-token' });
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [pairingToken, adminPairingToken, t]);

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-12">
      <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <p className="text-center text-sm text-gray-500">Koolman Work</p>
        <h1 className="mt-1 text-center text-xl font-semibold text-gray-900">{t('title')}</h1>

        <div className="mt-6">
          {state.phase === 'booting' ||
          state.phase === 'signing-in' ||
          state.phase === 'linking' ? (
            <ProgressBlock label={state.message} />
          ) : state.phase === 'success' ? (
            <SuccessBlock employeeName={state.employeeName} />
          ) : state.phase === 'admin-success' ? (
            <AdminSuccessBlock />
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
  const t = useTranslations('pair');
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
      <p className="text-base font-medium text-gray-900">{t('success.title')}</p>
      <p className="text-sm text-gray-600">{t('success.welcome', { name: employeeName })}</p>
      <p className="text-xs text-gray-500">{t('success.lastStep')}</p>
      <p className="text-xs text-gray-400">{t('success.redirecting')}</p>
    </div>
  );
}

function AdminSuccessBlock() {
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
      <p className="text-base font-medium text-gray-900">เชื่อมต่อบัญชีแอดมินสำเร็จ</p>
      <p className="text-sm text-gray-600">เมนูแอดมินจะปรากฏในแชท OA ภายในไม่กี่วินาที</p>
      <p className="text-xs text-gray-400">กำลังพาไปเพิ่มเพื่อน OA...</p>
    </div>
  );
}

function ErrorBlock({ message, canRetry }: { message: string; canRetry: boolean }) {
  const t = useTranslations('pair');
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
      <p className="text-base font-medium text-gray-900">{t('error.title')}</p>
      <p className="text-sm text-gray-600">{message}</p>
      {canRetry && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-2 rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700"
        >
          {t('retry')}
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
