'use client';

import { useState, useTransition } from 'react';
import { setLocale } from '@/lib/i18n/actions';
import { LOCALE_LABELS, LOCALES, type Locale } from '@/lib/i18n/config';
import { cn } from '@/lib/utils';

/**
 * First-run language picker. Big autonym buttons (never flags). Pre-selected
 * to the best guess; one tap confirms. Writes via setLocale (which stamps
 * localeChosenByEmployeeAt, so this never reappears).
 */
export function LanguageModal({ preselect }: { preselect: Locale }) {
  const [selected, setSelected] = useState<Locale>(preselect);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  if (done) return null;

  function confirm() {
    startTransition(async () => {
      await setLocale(selected);
      setDone(true);
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Choose language"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        <h2 className="text-center text-base font-semibold text-gray-900">
          เลือกภาษา · Choose your language
        </h2>
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
          ตกลง · OK
        </button>
      </div>
    </div>
  );
}
