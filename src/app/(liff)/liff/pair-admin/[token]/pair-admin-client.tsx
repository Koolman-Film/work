'use client';

/**
 * Client orchestrator for /liff/pair-admin/[token].
 *
 * Much simpler than the worker pair-client: single flow, Thai-only (admin
 * panel is intentionally untranslated), no dispatch/dest handling.
 *
 *   liffBootstrap() → linkLineToAdmin({ pairingToken }) → success / error.
 *
 * On success there's no redirect — the admin's job here is done; the admin
 * rich menu appears in the OA chat within seconds.
 */

import { useEffect, useState } from 'react';
import { type LinkLineToAdminResult, linkLineToAdmin } from '@/lib/auth/link-line-to-admin';
import { type LiffBootstrapError, liffBootstrap } from '@/lib/liff/init';

type PhaseState =
  | { phase: 'working'; message: string }
  | { phase: 'success' }
  | { phase: 'error'; message: string; canRetry: boolean };

export default function PairAdminClient({ pairingToken }: { pairingToken: string }) {
  const [state, setState] = useState<PhaseState>({
    phase: 'working',
    message: 'กำลังเตรียมการเชื่อมต่อ…',
  });

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        setState({ phase: 'working', message: 'กำลังเข้าสู่ระบบด้วย LINE…' });
        await liffBootstrap();
        if (cancelled) return;

        setState({ phase: 'working', message: 'กำลังเชื่อมต่อบัญชี…' });
        const result: LinkLineToAdminResult = await linkLineToAdmin({ pairingToken });
        if (cancelled) return;

        if (result.ok) {
          setState({ phase: 'success' });
        } else {
          setState({ phase: 'error', message: result.message, canRetry: false });
        }
      } catch (err) {
        if (cancelled) return;
        const e = err as LiffBootstrapError;
        const message =
          e?.kind === 'not-in-line'
            ? 'กรุณาเปิดลิงก์นี้ในแอป LINE บนมือถือ'
            : e?.kind === 'no-id-token'
              ? 'ไม่ได้รับโทเคนจาก LINE กรุณาลองใหม่'
              : e?.kind === 'supabase-rejected'
                ? 'ระบบปฏิเสธการเข้าสู่ระบบ กรุณาลองใหม่'
                : 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง';
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
        <h1 className="mt-1 text-center text-xl font-semibold text-gray-900">
          เชื่อมต่อ LINE สำหรับผู้ดูแล
        </h1>

        <div className="mt-6">
          {state.phase === 'working' ? (
            <div className="flex flex-col items-center gap-4 text-center">
              <Spinner />
              <p className="text-sm text-gray-600">{state.message}</p>
            </div>
          ) : state.phase === 'success' ? (
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
              <p className="text-base font-medium text-gray-900">เชื่อมต่อสำเร็จ</p>
              <p className="text-sm text-gray-600">เมนูแอดมินจะปรากฏในแชท OA ภายในไม่กี่วินาที</p>
            </div>
          ) : (
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
              <p className="text-base font-medium text-gray-900">เชื่อมต่อไม่สำเร็จ</p>
              <p className="text-sm text-gray-600">{state.message}</p>
              {state.canRetry && (
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="mt-2 rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700"
                >
                  ลองใหม่
                </button>
              )}
            </div>
          )}
        </div>
      </div>
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
