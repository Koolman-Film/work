import { describe, expect, it } from 'vitest';
import { resolveLocale, resolveLocaleFromAcceptLanguage } from './resolve';

describe('resolveLocaleFromAcceptLanguage', () => {
  it('returns null for empty or missing input', () => {
    expect(resolveLocaleFromAcceptLanguage(null)).toBeNull();
    expect(resolveLocaleFromAcceptLanguage('')).toBeNull();
  });

  it('matches exact locale codes', () => {
    expect(resolveLocaleFromAcceptLanguage('th')).toBe('th');
    expect(resolveLocaleFromAcceptLanguage('en')).toBe('en');
    expect(resolveLocaleFromAcceptLanguage('zh-CN')).toBe('zh-CN');
    expect(resolveLocaleFromAcceptLanguage('my')).toBe('my');
    expect(resolveLocaleFromAcceptLanguage('lo')).toBe('lo');
  });

  it('matches case-insensitively', () => {
    expect(resolveLocaleFromAcceptLanguage('TH')).toBe('th');
    expect(resolveLocaleFromAcceptLanguage('zh-cn')).toBe('zh-CN');
  });

  it('matches bare-language requests to a supported regional variant', () => {
    // Browser sends "zh" with no region — we have only zh-CN, so it wins.
    expect(resolveLocaleFromAcceptLanguage('zh')).toBe('zh-CN');
  });

  it('matches region-tagged requests to bare-language locales', () => {
    // Header "th-TH" + locale "th" (no region) → match. "th" is region-agnostic
    // so accepting any region is correct.
    expect(resolveLocaleFromAcceptLanguage('th-TH')).toBe('th');
    expect(resolveLocaleFromAcceptLanguage('en-US')).toBe('en');
    expect(resolveLocaleFromAcceptLanguage('en-GB')).toBe('en');
    expect(resolveLocaleFromAcceptLanguage('my-MM')).toBe('my');
    expect(resolveLocaleFromAcceptLanguage('lo-LA')).toBe('lo');
  });

  it('does NOT promote a region-tagged request across regions', () => {
    // Critical: zh-TW (Traditional) must NOT silently match zh-CN
    // (Simplified). If we don't support TW, return null.
    expect(resolveLocaleFromAcceptLanguage('zh-TW')).toBeNull();
    expect(resolveLocaleFromAcceptLanguage('zh-HK')).toBeNull();
    expect(resolveLocaleFromAcceptLanguage('zh-Hant')).toBeNull();
  });

  it('honors q-value ordering', () => {
    // Highest q wins.
    expect(resolveLocaleFromAcceptLanguage('en;q=0.5,th;q=0.9')).toBe('th');
    expect(resolveLocaleFromAcceptLanguage('th;q=0.3,en;q=0.9')).toBe('en');
  });

  it('skips unsupported tags and picks the next match', () => {
    // Japanese is unsupported. Falls through to English.
    expect(resolveLocaleFromAcceptLanguage('ja-JP,en;q=0.5')).toBe('en');
    // German + Korean + Vietnamese all unsupported → null
    expect(resolveLocaleFromAcceptLanguage('de-DE,ko-KR;q=0.7,vi;q=0.5')).toBeNull();
  });

  it('handles malformed input gracefully', () => {
    expect(resolveLocaleFromAcceptLanguage(';;,,;')).toBeNull();
    expect(resolveLocaleFromAcceptLanguage('th;q=notanumber')).toBeNull();
  });

  it('ignores tags with q=0 (explicit reject)', () => {
    // RFC 7231: q=0 means "do not accept". We must skip it.
    expect(resolveLocaleFromAcceptLanguage('th;q=0,en;q=0.5')).toBe('en');
  });
});

describe('resolveLocale', () => {
  it('prefers cookie over header when cookie is valid', () => {
    expect(
      resolveLocale({
        cookieValue: 'my',
        acceptLanguage: 'en-US,en;q=0.9',
      }),
    ).toBe('my');
  });

  it('falls through to Accept-Language when cookie is missing', () => {
    expect(resolveLocale({ cookieValue: null, acceptLanguage: 'zh-CN' })).toBe('zh-CN');
    expect(resolveLocale({ cookieValue: undefined, acceptLanguage: 'en-US' })).toBe('en');
  });

  it('falls through to Accept-Language when cookie is invalid', () => {
    // Manually-edited or stale cookie value not in LOCALES.
    expect(resolveLocale({ cookieValue: 'zh-TW', acceptLanguage: 'en' })).toBe('en');
    expect(resolveLocale({ cookieValue: 'xx', acceptLanguage: 'th' })).toBe('th');
  });

  it('falls back to DEFAULT_LOCALE when neither cookie nor header matches', () => {
    expect(resolveLocale({ cookieValue: null, acceptLanguage: null })).toBe('th');
    expect(resolveLocale({ cookieValue: 'zh-TW', acceptLanguage: 'ja' })).toBe('th');
  });
});
