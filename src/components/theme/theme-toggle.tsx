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

/** Marks <html> while the palette is mid-swap. The matching rule lives in
 *  globals.css under a `prefers-reduced-motion: no-preference` guard. */
const SWITCHING_ATTR = 'data-theme-switching';

/** Must stay >= the `--duration-base` the CSS rule animates over, or the
 *  attribute is pulled before the fade finishes and the colours snap. */
const SWITCH_MS = 250;

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

  // Clear the cross-fade window one duration AFTER the swap has landed.
  //
  // The palette does not change on click — setTheme sets a cookie and
  // revalidates, and <html data-theme> only moves when that re-render commits.
  // A timer started at click would therefore often expire before the colours
  // did, and the fade would never be seen. `pending` falling to false is the
  // commit, so the window is anchored to that instead.
  useEffect(() => {
    if (pending) return;
    const root = document.documentElement;
    if (!root.hasAttribute(SWITCHING_ATTR)) return;
    const timer = setTimeout(() => root.removeAttribute(SWITCHING_ATTR), SWITCH_MS);
    return () => clearTimeout(timer);
  }, [pending]);

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
              // Re-picking the current mode changes nothing on screen, so it
              // buys a server round-trip and a fade of identical colours.
              if (value === current) return;
              // Stamped BEFORE the request so the rule is already in force
              // whenever the re-render commits, however slow the round-trip.
              document.documentElement.setAttribute(SWITCHING_ATTR, '');
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
