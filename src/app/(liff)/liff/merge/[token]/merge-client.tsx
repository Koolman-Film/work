'use client';

/**
 * Client orchestrator for /liff/merge/[token].
 *
 * The employee opens this link in their LINE account. The flow:
 *
 *   liffBootstrap() → linkMergeAccounts({ mergeToken }) → success / error.
 *
 * On success the employee can navigate to /liff/home; both employee and admin
 * menus will now be accessible via this single LINE account.
 */

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { linkMergeAccounts } from '@/lib/auth/link-merge-accounts';
import { type LiffBootstrapError, liffBootstrap } from '@/lib/liff/init';

type PhaseState =
  | { phase: 'working' }
  | { phase: 'success' }
  | { phase: 'error'; message: string; canRetry: boolean };

export default function MergeClient({ mergeToken }: { mergeToken: string }) {
  const t = useTranslations('mergeWizard');
  const [state, setState] = useState<PhaseState>({ phase: 'working' });

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        setState({ phase: 'working' });
        await liffBootstrap();
        if (cancelled) return;

        const result = await linkMergeAccounts({ mergeToken });
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
  }, [mergeToken]);

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-12">
      <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <p className="text-center text-sm text-gray-500">Koolman Work</p>

        <div className="mt-6">
          {state.phase === 'working' ? (
            <div className="flex flex-col items-center gap-4 text-center">
              <Spinner />
              <p className="text-sm text-gray-600">{t('working')}</p>
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
              <p className="text-base font-medium text-gray-900">{t('successTitle')}</p>
              <p className="text-sm text-gray-600">{t('successBody')}</p>
              <Link
                href="/liff/home"
                className="mt-2 rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700"
              >
                {t('openHome')}
              </Link>
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
              <p className="text-base font-medium text-gray-900">{t('errorTitle')}</p>
              <p className="text-sm text-gray-600">{state.message}</p>
              {state.canRetry && (
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="mt-2 rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700"
                >
                  {t('retry')}
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
