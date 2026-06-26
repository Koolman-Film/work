'use client';

/**
 * Client orchestrator for /liff/merge/[token].
 *
 * The employee opens this link in their LINE account. Confirm-first flow (the
 * merge NEVER auto-runs — a mis-scanned QR must be cancellable):
 *
 *   liffBootstrap() → previewMergeAccounts() → show BOTH identities →
 *     employee taps confirm → linkMergeAccounts() → success / error
 *     employee taps cancel  → nothing happens
 */

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { linkMergeAccounts, previewMergeAccounts } from '@/lib/auth/link-merge-accounts';
import { type LiffBootstrapError, liffBootstrap } from '@/lib/liff/init';

type PhaseState =
  | { phase: 'working' }
  | { phase: 'confirm'; adminEmail: string; employeeName: string }
  | { phase: 'merging' }
  | { phase: 'success' }
  | { phase: 'cancelled' }
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
        const result = await previewMergeAccounts({ mergeToken });
        if (cancelled) return;
        if (result.ok) {
          setState({
            phase: 'confirm',
            adminEmail: result.adminEmail ?? '—',
            employeeName: result.employeeName,
          });
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

  async function confirm() {
    setState({ phase: 'merging' });
    const result = await linkMergeAccounts({ mergeToken });
    setState(
      result.ok
        ? { phase: 'success' }
        : { phase: 'error', message: result.message, canRetry: false },
    );
  }

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-12">
      <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <p className="text-center text-sm text-gray-500">Koolman Work</p>
        <div className="mt-6">
          {(state.phase === 'working' || state.phase === 'merging') && (
            <div className="flex flex-col items-center gap-4 text-center">
              <Spinner />
              <p className="text-sm text-gray-600">{t('working')}</p>
            </div>
          )}

          {state.phase === 'confirm' && (
            <div className="flex flex-col gap-4">
              <p className="text-center text-base font-medium text-gray-900">{t('confirmTitle')}</p>
              {/* Both identities, explicit, so a wrong scan is obvious. */}
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
                <Row label={t('confirmAdmin')} value={state.adminEmail} />
                <Row label={t('confirmEmployee')} value={state.employeeName} />
              </div>
              <p className="text-xs text-gray-500">{t('confirmBody')}</p>
              <div className="mt-1 flex gap-2">
                <button
                  type="button"
                  onClick={() => setState({ phase: 'cancelled' })}
                  className="flex-1 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  {t('cancel')}
                </button>
                <button
                  type="button"
                  onClick={confirm}
                  className="flex-1 rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700"
                >
                  {t('confirmCta')}
                </button>
              </div>
            </div>
          )}

          {state.phase === 'cancelled' && (
            <div className="flex flex-col items-center gap-3 text-center">
              <p className="text-base font-medium text-gray-900">{t('cancelledTitle')}</p>
              <p className="text-sm text-gray-600">{t('cancelledBody')}</p>
            </div>
          )}

          {state.phase === 'success' && (
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
          )}

          {state.phase === 'error' && (
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-gray-100 py-1.5 last:border-b-0">
      <span className="text-gray-500">{label}</span>
      <span className="min-w-0 truncate font-medium text-gray-900">{value}</span>
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
