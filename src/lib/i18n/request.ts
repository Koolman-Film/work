/**
 * next-intl getRequestConfig — runs on every Server Component request.
 *
 * Reads the locale from the NEXT_LOCALE cookie (set by the proxy on
 * first visit and by the language switcher on user action). If the
 * cookie is missing or malformed, falls back to DEFAULT_LOCALE — the
 * proxy will set the cookie correctly on the next request.
 *
 * Loads the locale's message catalog from `messages/<locale>.json`.
 * If the file is missing keys (common during the Phase 2 rollout while
 * translators catch up), next-intl will:
 *   - Log a warning in dev
 *   - Fall back to the key string itself in prod (visible "key.path"
 *     in the UI is the worst case, but the page still renders)
 *
 * We DO NOT load the DB User.locale here. See resolve.ts for the
 * reasoning — the cookie is the per-request source of truth; DB sync
 * happens at login time.
 */

import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { LOCALE_COOKIE_NAME } from './config';
import { resolveLocale } from './resolve';

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const headerStore = await headers();

  const locale = resolveLocale({
    cookieValue: cookieStore.get(LOCALE_COOKIE_NAME)?.value,
    acceptLanguage: headerStore.get('accept-language'),
  });

  // Dynamic import keyed by locale code. The bundler tree-shakes
  // unused message files at build time only when imports are static —
  // for runtime locale switching we accept the small cost of loading
  // all 5 catalogs into the server bundle. They're small (text only)
  // and the alternative (5 separate route trees) is much heavier.
  const messages = (await import(`../../../messages/${locale}.json`)).default;

  return { locale, messages };
});
