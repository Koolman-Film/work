/**
 * Locale-aware formatters for dates, times, and money.
 *
 * Wraps Intl.* with sensible defaults for this app. Why have these as
 * a thin layer instead of calling Intl directly:
 *   - Single place to swap behavior (e.g., Thai Buddhist calendar
 *     conversion, which Intl handles via `calendar: 'buddhist'`).
 *   - Single place to enforce "always show currency as ฿" regardless of
 *     locale — see formatMoney() below for why.
 *   - Cheaper to test / mock in unit tests.
 *
 * These helpers DON'T read from cookies or headers. The caller passes
 * the locale explicitly — usually from `useLocale()` in client
 * components or `getLocale()` from next-intl/server in server
 * components. That keeps them pure and testable.
 */

import type { Locale } from './config';

// ─── Dates ────────────────────────────────────────────────────────────────

/**
 * Format a date as "30 พฤษภาคม 2569" / "May 30, 2026" / etc.
 *
 * For Thai locale, we DON'T use Intl's `calendar: 'buddhist'` option —
 * it produces "30 พ.ค. 2569 BE" with the era suffix which looks
 * unnatural in Thai UI. Instead we format with Gregorian, then swap
 * the year (CE → BE = CE + 543). Same trick the existing
 * /liff/check-in page uses.
 *
 * For other locales, Intl.DateTimeFormat handles everything natively.
 */
export function formatDate(date: Date, locale: Locale): string {
  if (locale === 'th') {
    // Build the Thai string in two steps so we can swap the year.
    const ymd = new Intl.DateTimeFormat('th-TH-u-ca-gregory', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Asia/Bangkok',
    }).format(date);
    // The formatted string contains the Gregorian year (e.g., "30 พฤษภาคม 2026").
    // Swap to Buddhist year by parsing the year out and adding 543.
    const ceYear = date.toLocaleDateString('en-US', {
      year: 'numeric',
      timeZone: 'Asia/Bangkok',
    });
    const beYear = String(Number(ceYear) + 543);
    return ymd.replace(ceYear, beYear);
  }
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Bangkok',
  }).format(date);
}

/** Short date like "30/05/2026" — for table cells where space is tight. */
export function formatShortDate(date: Date, locale: Locale): string {
  if (locale === 'th') {
    const out = new Intl.DateTimeFormat('th-TH-u-ca-gregory', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'Asia/Bangkok',
    }).format(date);
    // Swap to BE year using the same trick as formatDate.
    const ceYear = date.toLocaleDateString('en-US', {
      year: 'numeric',
      timeZone: 'Asia/Bangkok',
    });
    const beYear = String(Number(ceYear) + 543);
    return out.replace(ceYear, beYear);
  }
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Asia/Bangkok',
  }).format(date);
}

/** Time of day like "14:30" (24-hour, all locales). */
export function formatTime(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Bangkok',
  }).format(date);
}

// ─── Money ────────────────────────────────────────────────────────────────

/**
 * Format a Baht amount as "฿1,234.56" / "฿1.234,56" / "¥1,234.56" — wait,
 * we DON'T want ¥. Always show THB symbol regardless of locale because
 * the business is in Thailand and all money is in THB. Locale only
 * controls the number separators (decimal/thousand).
 *
 * Implementation: format the number with the locale's separator rules,
 * then prepend "฿" manually. Intl.NumberFormat with `currency: 'THB'`
 * would produce locale-translated currency display like "1.234,56 THB"
 * for some locales — not what we want.
 */
export function formatMoney(amount: number | string, locale: Locale): string {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(n)) return '฿—';

  const formatted = new Intl.NumberFormat(locale === 'zh-CN' ? 'zh-CN' : locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);

  return `฿${formatted}`;
}

/** Plain integer formatting with locale-aware thousand separators —
 *  for things like employee counts, day counts, etc. */
export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale).format(value);
}
