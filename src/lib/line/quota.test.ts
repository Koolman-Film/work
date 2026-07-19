import { beforeEach, describe, expect, it, vi } from 'vitest';

// quota.ts does `import 'server-only'`, which throws under the default
// vitest config (no react-server condition / alias). Mock it to a no-op so
// this stays a plain unit test — same pattern as audit/query.test.ts.
vi.mock('server-only', () => ({}));

import { __resetQuotaCache, hasQuotaHeadroom, QUOTA_RESERVE, remainingQuota } from './quota';

const mockFetch = (quota: number, used: number) =>
  vi.fn(async (url: string) =>
    url.endsWith('/consumption')
      ? { ok: true, json: async () => ({ totalUsage: used }) }
      : { ok: true, json: async () => ({ type: 'limited', value: quota }) },
  ) as unknown as typeof fetch;

beforeEach(() => {
  __resetQuotaCache();
  vi.stubEnv('LINE_MESSAGING_CHANNEL_ACCESS_TOKEN', 'test-token');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('remainingQuota', () => {
  it('returns quota minus usage', async () => {
    vi.stubGlobal('fetch', mockFetch(300, 120));
    expect(await remainingQuota()).toBe(180);
  });

  it('returns null when the API fails — callers must not be blocked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500 })) as unknown as typeof fetch,
    );
    expect(await remainingQuota()).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network');
      }) as unknown as typeof fetch,
    );
    expect(await remainingQuota()).toBeNull();
  });

  it('warns when the token is missing — an unreadable quota must not be silent', async () => {
    vi.stubEnv('LINE_MESSAGING_CHANNEL_ACCESS_TOKEN', '');
    expect(await remainingQuota()).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('is not set'));
  });

  it('warns when the API call fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500 })) as unknown as typeof fetch,
    );
    expect(await remainingQuota()).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('failed (network error or non-2xx)'),
    );
  });

  it('warns when the response has an unexpected shape (e.g. {"type":"none"})', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/consumption')
          ? { ok: true, json: async () => ({ totalUsage: 10 }) }
          : { ok: true, json: async () => ({ type: 'none' }) },
      ) as unknown as typeof fetch,
    );
    expect(await remainingQuota()).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('unexpected shape'));
  });
});

describe('hasQuotaHeadroom', () => {
  it('true when remaining is above the reserve', async () => {
    vi.stubGlobal('fetch', mockFetch(300, 300 - QUOTA_RESERVE - 1));
    expect(await hasQuotaHeadroom()).toBe(true);
  });

  it('false when remaining is at or below the reserve', async () => {
    vi.stubGlobal('fetch', mockFetch(300, 300 - QUOTA_RESERVE));
    expect(await hasQuotaHeadroom()).toBe(false);
  });

  it('FAILS OPEN — true when the quota cannot be read at all', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network');
      }) as unknown as typeof fetch,
    );
    expect(await hasQuotaHeadroom()).toBe(true);
  });
});
