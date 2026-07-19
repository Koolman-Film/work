/**
 * Unit tests for `linePushAdminIds` — the recipient predicate for admin LINE
 * pushes.
 *
 * These used to test `notifyAdminsOnLine`, the per-event fan-out that was
 * removed when the 09:30 digest replaced it. The predicate it used survived
 * and is now MORE load-bearing than before: the digest and any future LINE
 * path both resolve their audience through this one function, so a drift here
 * silently changes who hears about pending work.
 *
 * prisma is stubbed at the module boundary (same style as
 * require-role-line-fallback.test.ts).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from '@/lib/db/prisma';
import { linePushAdminIds } from './admin-line';

const mockedFindMany = vi.mocked(prisma.user.findMany);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('linePushAdminIds', () => {
  it('returns the id of every matching admin', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: minimal prisma stub
    mockedFindMany.mockResolvedValue([{ id: 'admin-1' }, { id: 'admin-2' }] as any);

    await expect(linePushAdminIds()).resolves.toEqual(['admin-1', 'admin-2']);
  });

  it('returns an empty list when nobody qualifies', async () => {
    mockedFindMany.mockResolvedValue([]);

    await expect(linePushAdminIds()).resolves.toEqual([]);
  });

  it('requires active + LINE-linked + liff.admin (or Superadmin)', async () => {
    mockedFindMany.mockResolvedValue([]);

    await linePushAdminIds();

    // Each clause matters: dropping `lineUserId` would queue pushes for admins
    // who never linked LINE, and dropping the role filter would deep-link
    // non-admins into /liff/admin/* pages that 404 for them.
    expect(mockedFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          archivedAt: null,
          lineUserId: { not: null },
          roleAssignments: {
            some: expect.objectContaining({
              role: expect.objectContaining({
                archivedAt: null,
                OR: expect.arrayContaining([
                  { isSuperadmin: true },
                  { permissions: { has: 'liff.admin' } },
                ]),
              }),
            }),
          },
        }),
      }),
    );
  });

  it('selects only the id — recipient resolution must not pull extra user data', async () => {
    mockedFindMany.mockResolvedValue([]);

    await linePushAdminIds();

    expect(mockedFindMany).toHaveBeenCalledWith(expect.objectContaining({ select: { id: true } }));
  });
});
