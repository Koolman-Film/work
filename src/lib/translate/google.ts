/**
 * Google Cloud Translation API v2 — thin REST wrapper.
 *
 * Why v2 (the simple "API key" surface) and not v3: v3 needs a GCP project
 * ID, a service-account JWT, and per-request parent paths. v2 takes a single
 * API key as a query param and auto-detects the source language — exactly
 * what we need to turn a staff member's Burmese/Lao/Khmer leave reason into
 * Thai. The key is server-only (never NEXT_PUBLIC_); this module is imported
 * solely from the `translateText` server action.
 *
 * Pure I/O: no DB, no caching. The action layer owns the cache so this stays
 * trivially mockable in tests.
 */

const ENDPOINT = 'https://translation.googleapis.com/language/translate/v2';

/** Raised for every failure mode so callers can branch on one type. */
export class TranslateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TranslateError';
  }
}

export type TranslateResult = {
  translatedText: string;
  /** ISO-ish code Google detected, e.g. "my" (Burmese), "th", "en". */
  detectedSourceLang: string;
};

/** Minimal entity decode — the v2 API escapes punctuation (`&#39;`, `&quot;`,
 *  `&amp;`, `&lt;`, `&gt;`) even when `format: 'text'` is requested. Thai and
 *  the SE-Asian scripts we translate from don't otherwise contain `&`-markup,
 *  so this short table is sufficient (and avoids a DOM/parser dependency). */
function decodeEntities(s: string): string {
  return s
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&'); // last — so "&amp;lt;" → "&lt;", not "<"
}

/**
 * Translate one string. Returns the Thai (or `target`) text and the language
 * Google auto-detected for the source. Throws {@link TranslateError} on a
 * missing key, a non-200 response, or a body without a usable translation.
 */
export async function translateOnce(text: string, target: string): Promise<TranslateResult> {
  const key = process.env.GOOGLE_TRANSLATE_API_KEY;
  if (!key) {
    throw new TranslateError('GOOGLE_TRANSLATE_API_KEY is not set');
  }

  let res: Response;
  try {
    res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: text, target, format: 'text' }),
    });
  } catch (cause) {
    throw new TranslateError(`Translation request failed: ${(cause as Error).message}`);
  }

  if (!res.ok) {
    // Surface Google's error message when present; it's the actionable bit
    // ("API key not valid", "Daily Limit Exceeded", …).
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body.error?.message) detail = body.error.message;
    } catch {
      // non-JSON error body — keep the status code
    }
    throw new TranslateError(`Translation API error: ${detail}`);
  }

  const body = (await res.json()) as {
    data?: { translations?: { translatedText?: string; detectedSourceLanguage?: string }[] };
  };
  const hit = body.data?.translations?.[0];
  if (!hit?.translatedText) {
    throw new TranslateError('Translation API returned no result');
  }

  return {
    translatedText: decodeEntities(hit.translatedText),
    detectedSourceLang: hit.detectedSourceLanguage ?? '',
  };
}
