/**
 * Pure helpers for the LIFF first-run language modal. No I/O — the
 * caller (syncLiffLocale Server Action) supplies the inputs so these
 * stay trivially testable.
 */

import { DEFAULT_LOCALE, isLocale, type Locale } from './config';
import { resolveLocaleFromAcceptLanguage } from './resolve';

/** The modal fires exactly once: when the worker has never explicitly
 *  chosen a language. Admin-set defaults do NOT suppress it (decided:
 *  "always show, pre-selected"). */
export function shouldShowLanguageModal(chosenAt: Date | null | undefined): boolean {
  return chosenAt == null;
}

/**
 * Pre-selection for the modal. Order: admin default (if a supported
 * locale) → Accept-Language match → Thai. `liff.getLanguage()` is layered
 * on top of this on the client (see liff-locale-gate.tsx) as an optional
 * enhancement; this server-side resolver is the dependable floor.
 */
export function resolvePreselectLocale(input: {
  adminDefault: string | null | undefined;
  acceptLanguage: string | null | undefined;
}): Locale {
  if (isLocale(input.adminDefault)) return input.adminDefault;
  const fromHeader = resolveLocaleFromAcceptLanguage(input.acceptLanguage ?? null);
  if (fromHeader) return fromHeader;
  return DEFAULT_LOCALE;
}
