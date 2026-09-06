'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import { setTheme } from '@/lib/theme/actions';
import { isTheme, THEME_COOKIE_NAME, type Theme } from '@/lib/theme/config';

const OPTIONS = [
  { value: 'light', Icon: Sun, key: 'light' },
  { value: 'dark', Icon: Moon, key: 'dark' },
  { value: 'system', Icon: Monitor, key: 'system' },
] as const satisfies readonly { value: Theme; Icon: typeof Sun; key: string }[];

function readCookie(): Theme {
  const raw = document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${THEME_COOKIE_NAME}=`))
    ?.split('=')[1];
  return isTheme(raw) ? raw : 'system';
}

/**
 * Three-state theme control: Light / Dark / System.
 *
 * "System" is a real option rather than the absence of one — it keeps
 * tracking the OS after the user has picked it, which a two-state toggle
 * cannot express.
 *
 * The current value is read from the cookie in an effect rather than during
 * render. The server emits no `data-theme` for `system` (that omission is
 * what makes the default flash-free), so there is nothing in the markup to
 * read, and touching document.cookie during render would mismatch hydration.
 * Until the effect runs the control shows `system`, which is the default it
 * would resolve to anyway.
 */
export function ThemeToggle() {
  const t = useTranslations('theme');
  const [current, setCurrent] = useState<Theme>('system');
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setCurrent(readCookie());
  }, []);

  return (
    // <fieldset> rather than role="group": same semantics, native element,
    // and it is what a screen reader announces the set by. min-w-0 undoes the
    // UA's implicit min-inline-size so the pill hugs its three buttons.
    <fieldset className="inline-flex min-w-0 items-center gap-0.5 rounded-full border border-line bg-surface p-0.5">
      <legend className="sr-only">{t('label')}</legend>
      {OPTIONS.map(({ value, Icon, key }) => {
        const active = current === value;
        return (
          <button
            key={value}
            type="button"
            // Stable hook for tests: the accessible name is translated into
            // six locales, so selecting on it makes a test depend on which
            // language the session happens to be in.
            data-theme-option={value}
            aria-pressed={active}
            aria-label={t(key)}
            title={t(key)}
            disabled={pending}
            onClick={() => {
              // Optimistic, so the highlight moves on the click rather than
              // after the server round-trip and revalidate.
              setCurrent(value);
              startTransition(() => {
                void setTheme(value);
              });
            }}
            className={
              active
                ? 'grid size-8 place-items-center rounded-full bg-brand-solid text-white'
                : 'grid size-8 place-items-center rounded-full text-ink-3 transition hover:bg-surface-hover hover:text-ink-2'
            }
          >
            <Icon size={15} aria-hidden="true" />
          </button>
        );
      })}
    </fieldset>
  );
}
