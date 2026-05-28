/**
 * Locale resolution chain — server-only utility.
 *
 * Order of precedence:
 *   1. NEXT_LOCALE cookie    (the user's explicit choice; written by the
 *                             language switcher Server Action)
 *   2. Accept-Language header (only at request edge — see resolveLocaleFromHeaders)
 *   3. DEFAULT_LOCALE        (Thai)
 *
 * Why no DB read here:
 *   - This module is called from next-intl's getRequestConfig and from
 *     the proxy. Both run on EVERY request. A Prisma read on every
 *     request would be wasteful — and the proxy runs at the edge where
 *     Prisma isn't even available.
 *   - DB-side resolution happens at LOGIN TIME instead: after a
 *     successful sign-in we read User.locale and rewrite the cookie if
 *     they differ. That keeps the per-request hot path cookie-only.
 *     (Phase 2 wires that login-time DB sync.)
 *
 * Accept-Language matching is permissive: "th-TH" matches "th",
 * "zh-CN;q=0.9,zh;q=0.8" matches "zh-CN". Unsupported tags fall through
 * to DEFAULT_LOCALE; we don't try to be clever (e.g., suggesting "ja"
 * speakers get "zh-CN" — bad idea).
 */

import { DEFAULT_LOCALE, isLocale, LOCALES, type Locale } from './config';

/**
 * Pick the best supported locale from an Accept-Language header value.
 *
 * Accept-Language is comma-separated language ranges with optional
 * q-values: `en-US,en;q=0.9,th;q=0.7`. We parse, sort by descending
 * q-value, then return the first one that matches any of our supported
 * locales. Matching is two-tier:
 *
 *   - Exact match: header "zh-CN" → locale "zh-CN"
 *   - Prefix match: header "th-TH" → locale "th" (we drop the region tag)
 *
 * We never auto-route "zh" (no region) to a specific variant — if the
 * browser doesn't specify Simplified vs Traditional, we default to
 * Simplified because that's what we support. If we later add zh-TW,
 * this rule revisits.
 */
export function resolveLocaleFromAcceptLanguage(headerValue: string | null): Locale | null {
  if (!headerValue) return null;

  // Parse: split on comma, then on semicolon for q-value.
  // Strip whitespace; default q=1.0 when not specified.
  const ranges = headerValue
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      if (!tag) return null;
      const qParam = params.find((p) => p.trim().startsWith('q='));
      const q = qParam ? Number(qParam.split('=')[1]) : 1.0;
      return { tag: tag.trim(), q: Number.isFinite(q) ? q : 0 };
    })
    .filter((x): x is { tag: string; q: number } => x != null && x.q > 0)
    .sort((a, b) => b.q - a.q);

  for (const { tag } of ranges) {
    const lower = tag.toLowerCase();

    // Tier 1: exact match. "zh-CN" → "zh-CN", "en" → "en".
    const exact = LOCALES.find((l) => l.toLowerCase() === lower);
    if (exact) return exact;

    // Tier 2: header has NO region (bare language). The user didn't
    // specify a regional variant, so we'll accept any of our supported
    // locales that share this language tag. "zh" → "zh-CN" (our only
    // Chinese), "en" already handled in tier 1.
    if (!lower.includes('-')) {
      const sharedLang = LOCALES.find((l) => l.toLowerCase().startsWith(`${lower}-`));
      if (sharedLang) return sharedLang;
    }

    // Tier 3: header HAS region (e.g., "en-US", "th-TH"). Match against
    // the bare-language form of our locales only — never across regions.
    // Critical: this prevents "zh-TW" (Traditional) from silently
    // matching our "zh-CN" (Simplified). The user explicitly said TW,
    // we don't have it, we return nothing rather than guessing.
    const lang = lower.split('-')[0];
    if (lang) {
      const bareLang = LOCALES.find((l) => l.toLowerCase() === lang);
      if (bareLang) return bareLang;
    }
  }

  return null;
}

/**
 * Resolve a locale from the available signals on the current request.
 *
 * Caller passes the cookie value + the Accept-Language header — this
 * function doesn't reach into next/headers itself so it stays callable
 * from the edge proxy too.
 */
export function resolveLocale({
  cookieValue,
  acceptLanguage,
}: {
  cookieValue: string | null | undefined;
  acceptLanguage: string | null | undefined;
}): Locale {
  if (isLocale(cookieValue)) return cookieValue;
  const fromHeader = resolveLocaleFromAcceptLanguage(acceptLanguage ?? null);
  if (fromHeader) return fromHeader;
  return DEFAULT_LOCALE;
}
