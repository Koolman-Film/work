'use client';

/**
 * MergePromptCard — dismissible entry-point for the admin→employee identity merge.
 *
 * Shown on the admin dashboard ONLY for pure admins (no Employee row) who
 * haven't dismissed it yet (mergePromptDismissedAt === null). The server
 * component (page.tsx) computes that condition and conditionally renders this.
 *
 * "Link account" triggers startAdminMerge(), which issues a merge token + QR;
 * the user scans the QR with their employee LINE account to complete the merge.
 *
 * "Not now" calls dismissMergePrompt(), which sets mergePromptDismissedAt and
 * hides the card on the next page load.
 */

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { dismissMergePrompt, startAdminMerge } from '@/lib/auth/start-admin-merge';

export function MergePromptCard() {
  const t = useTranslations('mergeWizard');

  // null = initial state (card visible, no QR yet)
  // object = QR issued successfully
  // 'dismissed' = admin clicked "Not now"
  // 'error' = startAdminMerge returned ok: false
  type State =
    | { phase: 'idle' }
    | { phase: 'qr'; url: string; qrDataUrl: string }
    | { phase: 'dismissed' }
    | { phase: 'error'; message: string };

  const [state, setState] = useState<State>({ phase: 'idle' });
  const [isPendingLink, startLinkTransition] = useTransition();
  const [isPendingDismiss, startDismissTransition] = useTransition();

  if (state.phase === 'dismissed') return null;

  function handleLink() {
    startLinkTransition(async () => {
      const result = await startAdminMerge();
      if (result.ok) {
        setState({ phase: 'qr', url: result.url, qrDataUrl: result.qrDataUrl });
      } else {
        setState({ phase: 'error', message: result.message });
      }
    });
  }

  function handleDismiss() {
    startDismissTransition(async () => {
      await dismissMergePrompt();
      setState({ phase: 'dismissed' });
    });
  }

  return (
    <div className="mb-4 rounded-xl border border-primary-200 bg-primary-50 px-5 py-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-primary-900">{t('cardTitle')}</p>
          <p className="mt-0.5 text-sm text-primary-700">{t('cardBody')}</p>

          {state.phase === 'error' && (
            <p className="mt-2 text-sm font-medium text-red-600">{state.message}</p>
          )}

          {state.phase === 'qr' && (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-primary-600">{t('scanHint')}</p>
              <img
                src={state.qrDataUrl}
                alt="QR code"
                width={160}
                height={160}
                className="rounded-lg border border-primary-200"
              />
              <p className="break-all text-xs text-ink-3">{state.url}</p>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {state.phase !== 'qr' && (
            <Button
              variant="primary"
              size="sm"
              onClick={handleLink}
              disabled={isPendingLink || isPendingDismiss}
            >
              {isPendingLink ? t('working') : t('cardCta')}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDismiss}
            disabled={isPendingDismiss || isPendingLink}
          >
            {t('dismiss')}
          </Button>
        </div>
      </div>
    </div>
  );
}
