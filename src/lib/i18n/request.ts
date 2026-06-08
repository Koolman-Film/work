/**
 * next-intl getRequestConfig — runs on every Server Component request.
 *
 * Reads the locale from the NEXT_LOCALE cookie (set by the proxy on
 * first visit and by the language switcher on user action). If the
 * cookie is missing or malformed, falls back to DEFAULT_LOCALE — the
 * proxy will set the cookie correctly on the next request.
 *
 * Messages come from `getMessages(locale)`, which merges catalogs with
 * the fallback chain: target ← English ← Thai (Thai is the complete
 * source of truth). A missing key in the target locale first falls back
 * to English, then to Thai, before next-intl renders the raw key string.
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

  // getMessages applies the fallback chain (target ← en ← th), so an
  // untranslated key renders English, then Thai, before the raw key.
  const { getMessages } = await import('./messages');
  return { locale, messages: getMessages(locale) };
});
