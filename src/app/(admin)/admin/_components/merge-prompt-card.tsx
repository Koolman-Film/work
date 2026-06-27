'use client';

/**
 * MergePromptCard — entry-point for the admin→employee identity merge.
 *
 * Two placements share this component:
 *   - Dashboard (dismissible): shown to pure admins who haven't dismissed it
 *     (mergePromptDismissedAt === null). The "Not now" button hides it for good.
 *   - Profile page (dismissible={false}): the PERMANENT door. Because dismiss
 *     is one-way, an admin who dismissed the nudge — or changed their mind —
 *     still needs a way back; the profile card always offers it.
 *
 * "Link account" triggers startAdminMerge(), which issues a merge token + QR;
 * the user scans the QR with their employee LINE account to complete the merge.
 *
 * "Not now" calls dismissMergePrompt(), which sets mergePromptDismissedAt and
 * hides the card on the next page load (only rendered when dismissible).
 */

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import {
  dismissMergePrompt,
  listMergeableEmployees,
  startAdminMerge,
} from '@/lib/auth/start-admin-merge';

export function MergePromptCard({ dismissible = true }: { dismissible?: boolean }) {
  const t = useTranslations('mergeWizard');

  type State =
    | { phase: 'idle' }
    | { phase: 'picker'; employees: { userId: string; name: string }[]; selected: string }
    | { phase: 'qr'; url: string; qrDataUrl: string }
    | { phase: 'dismissed' }
    | { phase: 'error'; message: string };

  const [state, setState] = useState<State>({ phase: 'idle' });
  const [isPendingLink, startLinkTransition] = useTransition();
  const [isPendingDismiss, startDismissTransition] = useTransition();

  if (state.phase === 'dismissed') return null;

  function openPicker() {
    startLinkTransition(async () => {
      const employees = await listMergeableEmployees();
      setState({ phase: 'picker', employees, selected: employees[0]?.userId ?? '' });
    });
  }

  function generateQr(employeeUserId: string) {
    startLinkTransition(async () => {
      const result = await startAdminMerge({ employeeUserId });
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

          {state.phase === 'picker' && (
            <div className="mt-3 space-y-2">
              {state.employees.length === 0 ? (
                <p className="text-sm text-primary-700">{t('pickerEmpty')}</p>
              ) : (
                <>
                  <label className="block text-xs text-primary-600" htmlFor="merge-employee">
                    {t('pickerLabel')}
                  </label>
                  <select
                    id="merge-employee"
                    value={state.selected}
                    onChange={(e) => setState({ ...state, selected: e.target.value })}
                    className="w-full rounded-md border border-primary-200 bg-white px-3 py-2 text-sm"
                  >
                    {state.employees.map((emp) => (
                      <option key={emp.userId} value={emp.userId}>
                        {emp.name}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>
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
          {state.phase === 'idle' && (
            <Button
              variant="primary"
              size="sm"
              onClick={openPicker}
              disabled={isPendingLink || isPendingDismiss}
            >
              {isPendingLink ? t('working') : t('cardCta')}
            </Button>
          )}
          {state.phase === 'picker' && state.employees.length > 0 && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => generateQr(state.selected)}
              disabled={isPendingLink || !state.selected}
            >
              {isPendingLink ? t('working') : t('pickerCta')}
            </Button>
          )}
          {dismissible && state.phase !== 'qr' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDismiss}
              disabled={isPendingDismiss || isPendingLink}
            >
              {t('dismiss')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
