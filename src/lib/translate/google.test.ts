/**
 * Unit tests for translateOnce — the thin Google Cloud Translation API v2
 * wrapper. `fetch` is stubbed at the global boundary; no network, no key
 * leakage. We assert the request shape (endpoint + key + body) and the
 * response mapping (translatedText / detectedSourceLanguage), plus the
 * two failure modes callers depend on: missing key and non-200.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TranslateError, translateOnce } from './google';

const KEY = 'test-key-123';

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.stubEnv('GOOGLE_TRANSLATE_API_KEY', KEY);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('translateOnce', () => {
  it('posts q/target/format to the v2 endpoint with the API key', async () => {
    const fetchMock = mockFetchOnce({
      data: { translations: [{ translatedText: 'สวัสดี', detectedSourceLanguage: 'my' }] },
    });

    await translateOnce('မင်္ဂလာပါ', 'th');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toContain('https://translation.googleapis.com/language/translate/v2');
    expect(url).toContain(`key=${KEY}`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ q: 'မင်္ဂလာပါ', target: 'th', format: 'text' });
  });

  it('maps translatedText + detectedSourceLanguage', async () => {
    mockFetchOnce({
      data: { translations: [{ translatedText: 'สวัสดี', detectedSourceLanguage: 'my' }] },
    });

    const result = await translateOnce('မင်္ဂလာပါ', 'th');

    expect(result).toEqual({ translatedText: 'สวัสดี', detectedSourceLang: 'my' });
  });

  it('HTML-entity-decodes the translated text', async () => {
    // The v2 API entity-escapes punctuation even with format:'text'.
    mockFetchOnce({
      data: {
        translations: [
          { translatedText: 'It&#39;s &quot;fine&quot; &amp; ok', detectedSourceLanguage: 'en' },
        ],
      },
    });

    const result = await translateOnce('xxx', 'th');

    expect(result.translatedText).toBe('It\'s "fine" & ok');
  });

  it('throws TranslateError when the API key is missing', async () => {
    vi.stubEnv('GOOGLE_TRANSLATE_API_KEY', '');
    mockFetchOnce({});

    await expect(translateOnce('hi', 'th')).rejects.toBeInstanceOf(TranslateError);
  });

  it('throws TranslateError on a non-200 response', async () => {
    mockFetchOnce({ error: { code: 403, message: 'API key not valid' } }, false, 403);

    await expect(translateOnce('hi', 'th')).rejects.toBeInstanceOf(TranslateError);
  });

  it('throws TranslateError on a malformed body (no translations)', async () => {
    mockFetchOnce({ data: { translations: [] } });

    await expect(translateOnce('hi', 'th')).rejects.toBeInstanceOf(TranslateError);
  });
});
