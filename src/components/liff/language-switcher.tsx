'use client';

import { Languages } from 'lucide-react';
import { useLocale } from 'next-intl';
import { useState } from 'react';
import { isLocale, LOCALE_LABELS, type Locale } from '@/lib/i18n/config';
import { LanguageModal } from './language-modal';

/**
 * Always-visible language button for LIFF pages. Shows a languages glyph +
 * the CURRENT locale's autonym (e.g. "ไทย", "မြန်မာ") — never a flag: flags
 * map to countries, not languages, and the autonym keeps the button findable
 * even when the rest of the UI is in a script the worker can't read.
 *
 * Tapping opens the same LanguageModal as the first-run gate, but in
 * dismissible mode (backdrop tap cancels). setLocale persists cookie + DB
 * and revalidates the layout, so the page re-renders translated in place.
 */
export function LanguageSwitcher() {
  const raw = useLocale();
  const locale: Locale = isLocale(raw) ? raw : 'th';
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
      >
        <Languages className="h-4 w-4 text-gray-500" aria-hidden="true" />
        {LOCALE_LABELS[locale]}
      </button>
      {open && <LanguageModal preselect={locale} onClose={() => setOpen(false)} />}
    </>
  );
}
