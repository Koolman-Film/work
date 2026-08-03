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

/**
 * Pin a locale to Western digits (`1 2 3`) via the Unicode `nu` extension.
 *
 * Only Burmese needs it today — ICU resolves `my` to the `mymr` numbering
 * system, so `Intl` renders ၁၂၃ — but the extension is a no-op for locales
 * already on `latn`, so applying it uniformly costs nothing and means a future
 * locale (Bengali, Farsi, Nepali…) cannot quietly reintroduce the problem.
 *
 * Digits only. Grouping and decimal marks still come from the locale.
 */
export function latnDigits(locale: string): string {
  return locale.includes('-u-') ? `${locale}-nu-latn` : `${locale}-u-nu-latn`;
}

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
  return new Intl.DateTimeFormat(latnDigits(locale), {
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
  return new Intl.DateTimeFormat(latnDigits(locale), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Asia/Bangkok',
  }).format(date);
}

/**
 * Format a YYYY-MM pay-period month as "พฤษภาคม 2569" / "May 2026" / etc.
 * Thai gets the BE-year swap, same trick as formatDate. Returns the raw
 * string unchanged when it isn't a parseable YYYY-MM.
 */
export function formatMonthYear(month: string, locale: Locale): string {
  const date = new Date(`${month}-01T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return month;
  if (locale === 'th') {
    const out = new Intl.DateTimeFormat('th-TH-u-ca-gregory', {
      month: 'long',
      year: 'numeric',
      timeZone: 'Asia/Bangkok',
    }).format(date);
    const ceYear = date.toLocaleDateString('en-US', {
      year: 'numeric',
      timeZone: 'Asia/Bangkok',
    });
    return out.replace(ceYear, String(Number(ceYear) + 543));
  }
  return new Intl.DateTimeFormat(latnDigits(locale), {
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Bangkok',
  }).format(date);
}

/** Time of day like "14:30" (24-hour, all locales). */
export function formatTime(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(latnDigits(locale), {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Bangkok',
  }).format(date);
}

// ─── Money ────────────────────────────────────────────────────────────────

/**
 * ONE numeric convention for money, in every language: Western digits, comma
 * grouping, dot decimal. `฿1,234,567.89` reads the same on all six payslips.
 *
 * Letting the reader's locale choose broke two of the six, and both matter on
 * a document about someone's pay:
 *
 *   my → `฿၁,၂၃၄,၅၆၇.၈၉`  ICU resolves Burmese to the `mymr` numbering system,
 *                          so salary figures came out in Myanmar digits while
 *                          bank account numbers, employee ids and anything else
 *                          carried as a plain string stayed Western — the same
 *                          slip showing two sets of digits.
 *   lo → `฿1.234.567,89`   Lao uses European separators, so the dot is the
 *                          THOUSANDS mark. A Thai payroll admin reading that
 *                          slip sees a decimal point. Off by a factor of 1000,
 *                          and nothing about it looks wrong.
 *
 * th / en / zh-CN / km already produced `1,234,567.89`, so pinning the numeric
 * part changes only the two that were broken. The reference locale is used for
 * digits and separators ONLY — the ฿ symbol is prepended by hand, because
 * `currency: 'THB'` would translate the display to things like "1.234,56 THB".
 */
const MONEY_NUMERIC_LOCALE = 'en-US';

export function formatMoney(amount: number | string, locale: Locale): string {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(n)) return '฿—';

  // `locale` is deliberately unused for the numeric part — see above. It stays
  // in the signature because every call site passes it and the money format is
  // a per-document decision we may yet want to vary.
  void locale;

  const formatted = new Intl.NumberFormat(MONEY_NUMERIC_LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);

  return `฿${formatted}`;
}

/**
 * Plain integer formatting with locale-aware thousand separators.
 *
 * Digits are pinned to `latn` for the same reason as money: Burmese otherwise
 * renders counts in Myanmar digits beside Western ones. Grouping is left to the
 * locale here — unlike money, these are counts of days and people, small enough
 * that a separator rarely appears at all.
 */
export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(latnDigits(locale)).format(value);
}
