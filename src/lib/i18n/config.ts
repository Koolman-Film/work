/**
 * i18n configuration — single source of truth for supported locales.
 *
 * Everything else (cookie reader, Accept-Language matcher, language
 * switcher, format helpers) imports from here. Adding a new locale
 * is a 2-step process:
 *   1. Add it to LOCALES below + add a label to LOCALE_LABELS.
 *   2. Create messages/<code>.json with translations.
 *
 * No middleware or page-level wiring changes — everything reads this
 * file at runtime.
 *
 * Locale codes follow BCP 47:
 *   - 'th'      Thai (Thailand) — source of truth, all keys originate here
 *   - 'en'      English (generic; not en-US or en-GB) — proofread by our own English-reader
 *   - 'my'      Burmese (Myanmar) — stub until translator delivers
 *   - 'lo'      Lao — stub until translator delivers
 *   - 'zh-CN'   Chinese, Simplified — stub until translator delivers
 *   - 'km'      Khmer (Cambodia) — stub until translator delivers
 *
 * If we later add Traditional Chinese (zh-TW), the dropdown order should
 * keep zh-CN and zh-TW adjacent so users see them as related options.
 */

export const LOCALES = ['th', 'en', 'my', 'lo', 'zh-CN', 'km'] as const;
export type Locale = (typeof LOCALES)[number];

/** The "if everything else fails" locale. Used when:
 *   - The cookie has an unrecognized value (e.g., manually edited)
 *   - The DB has an old stale code we no longer support
 *   - Accept-Language matches nothing in our list */
export const DEFAULT_LOCALE: Locale = 'th';

/** Cookie name for the locale preference. Non-HttpOnly so the client
 *  language switcher can write it directly via `document.cookie` if
 *  needed (the Server Action path also works and is what we use). */
export const LOCALE_COOKIE_NAME = 'NEXT_LOCALE';

/** Cookie max-age — 1 year. Long enough that users almost never have
 *  their preference forgotten; short enough that an abandoned device
 *  eventually reverts to browser-detected language. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Human-readable language names shown in the switcher dropdown. Each
 *  label is in its OWN language (autonym) so users who can't read the
 *  current UI can still find their language. */
export const LOCALE_LABELS: Record<Locale, string> = {
  th: 'ไทย',
  en: 'English',
  my: 'မြန်မာ',
  lo: 'ລາວ',
  'zh-CN': '简体中文',
  km: 'ភាសាខ្មែរ',
};

/** Type guard — narrow an unknown string to Locale. Use this on any
 *  string read from cookies, headers, DB, or URL. */
export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}
