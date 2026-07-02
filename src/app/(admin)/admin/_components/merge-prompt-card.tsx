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
import { useMemo, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import {
  dismissMergePrompt,
  listMergeableEmployees,
  type MergeableEmployee,
  startAdminMerge,
} from '@/lib/auth/start-admin-merge';
import { initials } from '@/lib/format';
import { cn } from '@/lib/utils';

function fullName(e: MergeableEmployee): string {
  return `${e.firstName} ${e.lastName}`.trim();
}

/**
 * Non-interactive avatar for a picker row — the whole row is the click target,
 * so (unlike the shared Avatar) this must NOT render its own button.
 */
function RowAvatar({ name, src }: { name: string; src: string | null }) {
  return (
    <span className="inline-grid size-8 shrink-0 place-items-center overflow-hidden rounded-full border border-primary-200 bg-primary-50 font-display text-[11px] font-bold text-primary-700">
      {src ? (
        // biome-ignore lint/performance/noImgElement: short-lived signed storage URL; next/image caching doesn't apply
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        initials(name)
      )}
    </span>
  );
}

export function MergePromptCard({ dismissible = true }: { dismissible?: boolean }) {
  const t = useTranslations('mergeWizard');

  type State =
    | { phase: 'idle' }
    | { phase: 'picker'; employees: MergeableEmployee[]; selected: string; query: string }
    | { phase: 'qr'; url: string; qrDataUrl: string }
    | { phase: 'dismissed' }
    | { phase: 'error'; message: string };

  const [state, setState] = useState<State>({ phase: 'idle' });
  const [isPendingLink, startLinkTransition] = useTransition();
  const [isPendingDismiss, startDismissTransition] = useTransition();

  // Filter the picker list by name / nickname as the admin types.
  const filtered = useMemo(() => {
    if (state.phase !== 'picker') return [];
    const q = state.query.trim().toLowerCase();
    if (!q) return state.employees;
    return state.employees.filter((e) =>
      `${e.firstName} ${e.lastName} ${e.nickname ?? ''}`.toLowerCase().includes(q),
    );
  }, [state]);

  if (state.phase === 'dismissed') return null;

  function openPicker() {
    startLinkTransition(async () => {
      const employees = await listMergeableEmployees();
      setState({ phase: 'picker', employees, selected: employees[0]?.userId ?? '', query: '' });
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
                  <label className="block text-xs text-primary-600" htmlFor="merge-search">
                    {t('pickerLabel')}
                  </label>
                  <input
                    id="merge-search"
                    type="text"
                    value={state.query}
                    onChange={(e) => setState({ ...state, query: e.target.value })}
                    placeholder={t('pickerSearch')}
                    autoComplete="off"
                    className="w-full rounded-md border border-primary-200 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
                  />
                  <ul className="max-h-64 divide-y divide-primary-50 overflow-auto rounded-md border border-primary-100 bg-white">
                    {filtered.map((emp) => {
                      const name = fullName(emp);
                      const selected = emp.userId === state.selected;
                      return (
                        <li key={emp.userId}>
                          <button
                            type="button"
                            onClick={() => setState({ ...state, selected: emp.userId })}
                            className={cn(
                              'flex w-full items-center gap-3 px-3 py-2 text-left transition',
                              selected ? 'bg-primary-50' : 'hover:bg-gray-50',
                            )}
                          >
                            <RowAvatar name={name} src={emp.photoUrl} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-gray-900">
                                {name}
                              </span>
                              {emp.nickname && (
                                <span className="block truncate text-xs text-gray-500">
                                  {emp.nickname}
                                </span>
                              )}
                            </span>
                            {selected && <span className="shrink-0 text-primary-600">✓</span>}
                          </button>
                        </li>
                      );
                    })}
                    {filtered.length === 0 && (
                      <li className="px-3 py-3 text-center text-sm text-gray-400">ไม่พบรายการ</li>
                    )}
                  </ul>
                </>
              )}
            </div>
          )}

          {state.phase === 'qr' && (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-primary-600">{t('scanHint')}</p>
              {/* biome-ignore lint/performance/noImgElement: inline data: URL (QR), not a storage asset — next/image doesn't apply */}
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
