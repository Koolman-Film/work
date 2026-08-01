import { beforeEach, describe, expect, it, vi } from 'vitest';

// quota.ts does `import 'server-only'`, which throws under the default
// vitest config (no react-server condition / alias). Mock it to a no-op so
// this stays a plain unit test — same pattern as audit/query.test.ts.
vi.mock('server-only', () => ({}));

import {
  __resetQuotaCache,
  hasQuotaHeadroom,
  isAtWarnThreshold,
  QUOTA_RESERVE,
  QUOTA_WARN_RATIO,
  quotaSnapshot,
  remainingQuota,
} from './quota';

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

describe('quotaSnapshot', () => {
  it('reports limit, used and remaining together', async () => {
    vi.stubGlobal('fetch', mockFetch(300, 225));
    expect(await quotaSnapshot()).toEqual({ limit: 300, used: 225, remaining: 75 });
  });

  it('returns null when the quota cannot be read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500 })) as unknown as typeof fetch,
    );
    expect(await quotaSnapshot()).toBeNull();
  });
});

describe('isAtWarnThreshold', () => {
  it('false while consumption is below the warn ratio', async () => {
    // 224/300 = 74.7%
    expect(isAtWarnThreshold({ limit: 300, used: 224, remaining: 76 })).toBe(false);
  });

  it('true exactly at the warn ratio — 225 of 300 is the first message that warns', async () => {
    expect(isAtWarnThreshold({ limit: 300, used: 225, remaining: 75 })).toBe(true);
  });

  it('true above the warn ratio', async () => {
    expect(isAtWarnThreshold({ limit: 300, used: 280, remaining: 20 })).toBe(true);
  });

  it('false when the limit is zero — no ratio exists, must not divide by zero', async () => {
    expect(isAtWarnThreshold({ limit: 0, used: 0, remaining: 0 })).toBe(false);
  });

  it('warns strictly before the send guard trips, so the bell is an early warning', async () => {
    // The guard blocks at remaining <= QUOTA_RESERVE. The warn threshold must
    // fire well before that or it is not a warning, it is an obituary.
    const guardTripsAtUsed = 300 - QUOTA_RESERVE;
    const warnStartsAtUsed = Math.ceil(300 * QUOTA_WARN_RATIO);
    expect(warnStartsAtUsed).toBeLessThan(guardTripsAtUsed);
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
