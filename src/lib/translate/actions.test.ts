/**
 * Unit tests for the translateText server action. The two collaborators —
 * the auth gate (requireRole) and the Google client (translateOnce) — plus
 * prisma are stubbed at the module boundary. We pin the cache contract:
 *   - empty input short-circuits (no auth call, no DB, no API)
 *   - cache HIT returns stored text without calling Google
 *   - cache MISS calls Google, persists, returns cached:false
 *   - a unique-constraint race re-reads the cache instead of throwing
 *   - the action requires an authenticated session
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/require-role', () => ({
  requireRole: vi.fn(async () => ({ user: { id: 'u1' }, tier: 'Admin' })),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    translation: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock('./google', () => ({
  translateOnce: vi.fn(),
  TranslateError: class TranslateError extends Error {},
}));

import { requireRole } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';
import { translateText } from './actions';
import { translateOnce } from './google';
import { sourceHashFor } from './hash';

const mockedRequireRole = vi.mocked(requireRole);
// biome-ignore lint/suspicious/noExplicitAny: prisma mock surface is partial
const findUnique = prisma.translation.findUnique as any;
// biome-ignore lint/suspicious/noExplicitAny: prisma mock surface is partial
const create = prisma.translation.create as any;
const mockedTranslateOnce = vi.mocked(translateOnce);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('translateText', () => {
  it('short-circuits on empty/whitespace input — no auth, DB or API call', async () => {
    const result = await translateText('   ');

    expect(result).toEqual({ translatedText: '', detectedSourceLang: '', cached: false });
    expect(mockedRequireRole).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
    expect(mockedTranslateOnce).not.toHaveBeenCalled();
  });

  it('requires an authenticated session', async () => {
    findUnique.mockResolvedValue(null);
    mockedTranslateOnce.mockResolvedValue({ translatedText: 'x', detectedSourceLang: 'en' });
    create.mockResolvedValue({});

    await translateText('hello');

    expect(mockedRequireRole).toHaveBeenCalledWith(['Staff', 'Admin', 'Superadmin']);
  });

  it('returns the cached translation without calling Google on a hit', async () => {
    findUnique.mockResolvedValue({
      translatedText: 'สวัสดี',
      detectedSourceLang: 'my',
    });

    const result = await translateText('မင်္ဂလာပါ', 'th');

    expect(result).toEqual({ translatedText: 'สวัสดี', detectedSourceLang: 'my', cached: true });
    expect(mockedTranslateOnce).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('calls Google then persists on a miss', async () => {
    findUnique.mockResolvedValue(null);
    mockedTranslateOnce.mockResolvedValue({ translatedText: 'สวัสดี', detectedSourceLang: 'my' });
    create.mockResolvedValue({});

    const result = await translateText('မင်္ဂလာပါ', 'th');

    expect(result).toEqual({ translatedText: 'สวัสดี', detectedSourceLang: 'my', cached: false });
    expect(mockedTranslateOnce).toHaveBeenCalledWith('မင်္ဂလာပါ', 'th');
    expect(create).toHaveBeenCalledWith({
      data: {
        sourceHash: sourceHashFor('မင်္ဂလာပါ'),
        targetLang: 'th',
        sourceText: 'မင်္ဂလာပါ',
        translatedText: 'สวัสดี',
        detectedSourceLang: 'my',
      },
    });
  });

  it('recovers from a unique-constraint race by re-reading the cache', async () => {
    // First lookup misses; another request wins the insert; our create() throws
    // a P2002; the second lookup finds the winner's row.
    findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ translatedText: 'สวัสดี', detectedSourceLang: 'my' });
    mockedTranslateOnce.mockResolvedValue({ translatedText: 'สวัสดี', detectedSourceLang: 'my' });
    create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));

    const result = await translateText('မင်္ဂလာပါ', 'th');

    expect(result).toEqual({ translatedText: 'สวัสดี', detectedSourceLang: 'my', cached: true });
    expect(findUnique).toHaveBeenCalledTimes(2);
  });
});
