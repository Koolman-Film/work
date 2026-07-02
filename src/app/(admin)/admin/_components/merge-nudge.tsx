'use client';

/**
 * MergeNudge — a compact banner that POINTS to /admin/settings/line, where the
 * merge wizard now lives. Replaces the full inline MergePromptCard on the
 * dashboard + profile so those pages just surface the entry, not the flow.
 *
 * Dashboard: dismissible (writes mergePromptDismissedAt). Profile: permanent.
 */

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { dismissMergePrompt } from '@/lib/auth/start-admin-merge';

export function MergeNudge({ dismissible = true }: { dismissible?: boolean }) {
  const t = useTranslations('mergeWizard');
  const [dismissed, setDismissed] = useState(false);
  const [pending, startDismiss] = useTransition();

  if (dismissed) return null;

  return (
    <div className="mb-4 rounded-xl border border-primary-200 bg-primary-50 px-5 py-4 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-primary-900">{t('cardTitle')}</p>
          <p className="mt-0.5 text-sm text-primary-700">{t('cardBody')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/admin/settings/line"
            className="rounded-md bg-primary-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-primary-700"
          >
            {t('cardCta')}
          </Link>
          {dismissible && (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startDismiss(async () => {
                  await dismissMergePrompt();
                  setDismissed(true);
                })
              }
              className="rounded-md px-3 py-1.5 text-sm font-medium text-primary-700 transition hover:bg-primary-100 disabled:opacity-50"
            >
              {t('dismiss')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
