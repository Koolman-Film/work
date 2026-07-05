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
 *
 * EXPLICIT LOCALE OVERRIDE: when a caller passes a locale to an awaitable
 * server function (`getTranslations({ locale })`), next-intl forwards it here
 * as `locale`. We MUST honor it — that is how the payslip renderer resolves a
 * label in a target language (the employee's language, plus English/Thai as
 * the reference line) independent of the request cookie. Ignoring it silently
 * returned the cookie locale, which rendered `tRef`/`tEn` in the wrong
 * language (e.g. Thai twice on a Thai slip).
 */

import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { isLocale, LOCALE_COOKIE_NAME } from './config';
import { resolveLocale } from './resolve';

export default getRequestConfig(async ({ locale }) => {
  // Explicit override wins; otherwise resolve from the request (cookie → header).
  const resolved =
    locale && isLocale(locale)
      ? locale
      : resolveLocale({
          cookieValue: (await cookies()).get(LOCALE_COOKIE_NAME)?.value,
          acceptLanguage: (await headers()).get('accept-language'),
        });

  // getMessages applies the fallback chain (target ← en ← th), so an
  // untranslated key renders English, then Thai, before the raw key.
  const { getMessages } = await import('./messages');
  return { locale: resolved, messages: getMessages(resolved) };
});
