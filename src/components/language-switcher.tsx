'use client';

/**
 * Language switcher dropdown.
 *
 * Two display modes:
 *   - `variant="topbar"` — for the admin user-menu (compact, inline)
 *   - `variant="standalone"` — for the LIFF profile page + settings
 *     pages where the switcher gets its own row + label
 *
 * Behavior:
 *   - Reads the current locale from next-intl's useLocale().
 *   - On selection, calls the setLocale Server Action (which writes
 *     the cookie + persists to User.locale if logged in, then
 *     revalidates the layout).
 *   - useTransition keeps the dropdown disabled during the round-trip.
 *
 * Why not document.cookie + window.location.reload(): the Server
 * Action path is the same code path on every device (mobile LIFF, web
 * admin), persists to DB for cross-device sync, and avoids a reload
 * flash. The cost is a single Server Action round-trip vs. zero —
 * negligible.
 */

import { Languages } from 'lucide-react';
import { useLocale } from 'next-intl';
import { useTransition } from 'react';
import { setLocale } from '@/lib/i18n/actions';
import { isLocale, LOCALE_LABELS, LOCALES, type Locale } from '@/lib/i18n/config';
import { cn } from '@/lib/utils';

type Props = {
  variant?: 'topbar' | 'standalone';
};

export function LanguageSwitcher({ variant = 'standalone' }: Props) {
  const currentLocale = useLocale() as Locale;
  const [pending, startTransition] = useTransition();

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    if (!isLocale(next) || next === currentLocale) return;
    startTransition(async () => {
      await setLocale(next);
      // The Server Action calls revalidatePath; no manual reload needed.
    });
  }

  if (variant === 'topbar') {
    // Compact: just the dropdown with a globe icon inline. Sits inside
    // the user-menu popover above the sign-out button.
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700">
        <Languages size={16} className="text-gray-400" aria-hidden="true" />
        <select
          value={currentLocale}
          onChange={onChange}
          disabled={pending}
          aria-label="ภาษา / Language"
          className={cn(
            'flex-1 cursor-pointer rounded-md border border-gray-200 bg-white px-2 py-1 text-sm',
            'focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30',
            pending && 'opacity-60',
          )}
        >
          {LOCALES.map((code) => (
            <option key={code} value={code}>
              {LOCALE_LABELS[code]}
            </option>
          ))}
        </select>
      </div>
    );
  }

  // Standalone: full-row label + select for a settings page.
  return (
    <div>
      <label htmlFor="locale-select" className="block text-sm font-medium text-gray-700">
        ภาษา / Language
      </label>
      <select
        id="locale-select"
        value={currentLocale}
        onChange={onChange}
        disabled={pending}
        className={cn(
          'mt-1.5 block w-full max-w-xs rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm',
          'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30',
          pending && 'opacity-60',
        )}
      >
        {LOCALES.map((code) => (
          <option key={code} value={code}>
            {LOCALE_LABELS[code]}
          </option>
        ))}
      </select>
      <p className="mt-1 text-xs text-gray-500">
        การตั้งค่าจะถูกบันทึกในอุปกรณ์นี้ และซิงค์ข้ามอุปกรณ์เมื่อล็อกอินใหม่
      </p>
    </div>
  );
}
