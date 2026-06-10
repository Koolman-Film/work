'use client';

import { useState, useTransition } from 'react';
import { setLocale } from '@/lib/i18n/actions';
import { LOCALE_LABELS, LOCALES, type Locale } from '@/lib/i18n/config';
import { cn } from '@/lib/utils';

/**
 * Language picker modal. Big autonym buttons (never flags). Pre-selected
 * to the best guess; one tap confirms. Writes via setLocale (which stamps
 * localeChosenByEmployeeAt, so the first-run prompt never reappears).
 *
 * Two callers:
 *   - First-run gate (no `onClose`): not dismissible — the worker must pick.
 *   - Header switcher (`onClose` given): backdrop tap / Esc cancels freely.
 *
 * The header + confirm button are intentionally NOT driven by next-intl `t()`:
 * this modal runs BEFORE the worker has chosen a locale, so it must read in
 * whatever language is currently highlighted. The chrome lives in this tiny
 * inline map keyed by `selected` and updates live as the user taps — each
 * speaker sees the prompt in their own language the instant they pick it.
 */
const PICKER_CHROME: Record<Locale, { title: string; ok: string }> = {
  th: { title: 'เลือกภาษา', ok: 'ตกลง' },
  en: { title: 'Choose your language', ok: 'OK' },
  my: { title: 'ဘာသာစကားရွေးချယ်ပါ', ok: 'အိုကေ' },
  lo: { title: 'ເລືອກພາສາ', ok: 'ຕົກລົງ' },
  'zh-CN': { title: '选择语言', ok: '确定' },
  km: { title: 'ជ្រើសរើសភាសា', ok: 'យល់ព្រម' },
};

export function LanguageModal({ preselect, onClose }: { preselect: Locale; onClose?: () => void }) {
  const [selected, setSelected] = useState<Locale>(preselect);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  if (done) return null;

  const chrome = PICKER_CHROME[selected];

  function confirm() {
    startTransition(async () => {
      await setLocale(selected);
      setDone(true);
      onClose?.();
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={chrome.title}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={(e) => {
        // Backdrop tap only — clicks inside the sheet bubble up with a
        // different target, so they don't dismiss.
        if (e.target === e.currentTarget) onClose?.();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose?.();
      }}
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        <h2 className="text-center text-base font-semibold text-gray-900">{chrome.title}</h2>
        <div className="mt-4 grid grid-cols-1 gap-2">
          {LOCALES.map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => setSelected(code)}
              className={cn(
                'w-full rounded-xl border px-4 py-3 text-left text-base',
                code === selected
                  ? 'border-primary-500 bg-primary-50 font-semibold text-primary-700'
                  : 'border-gray-200 text-gray-800',
              )}
            >
              {LOCALE_LABELS[code]}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={confirm}
          disabled={pending}
          className="mt-5 w-full rounded-xl bg-primary-600 px-4 py-3 text-base font-medium text-white hover:bg-primary-700 disabled:opacity-60"
        >
          {chrome.ok}
        </button>
      </div>
    </div>
  );
}
