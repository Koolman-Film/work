import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/admin-area', () => ({
  requireAdminArea: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: { user: { update: vi.fn() } },
}));

import { requireAdminArea } from '@/lib/auth/admin-area';
import { prisma } from '@/lib/db/prisma';
import { markProductUpdatesSeen } from './actions';

const mockedRequireAdminArea = vi.mocked(requireAdminArea);
// biome-ignore lint/suspicious/noExplicitAny: partial prisma mock surface
const update = prisma.user.update as any;

function stubUser(id: string, seen: unknown) {
  // biome-ignore lint/suspicious/noExplicitAny: partial User shape for the gate
  mockedRequireAdminArea.mockResolvedValue({ user: { id, productUpdatesSeen: seen } } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('markProductUpdatesSeen', () => {
  it('unions new ids into the existing set (add-only)', async () => {
    stubUser('u1', ['a']);
    await markProductUpdatesSeen(['b', 'a']);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { productUpdatesSeen: ['a', 'b'] },
    });
  });

  it('treats a null column as an empty set', async () => {
    stubUser('u1', null);
    await markProductUpdatesSeen(['first-run.welcome']);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { productUpdatesSeen: ['first-run.welcome'] },
    });
  });

  it('skips the write when nothing new is added', async () => {
    stubUser('u1', ['a', 'b']);
    await markProductUpdatesSeen(['a']);
    expect(update).not.toHaveBeenCalled();
  });

  it('does not write when the auth gate rejects', async () => {
    mockedRequireAdminArea.mockRejectedValue(new Error('not found'));
    await expect(markProductUpdatesSeen(['a'])).rejects.toThrow('not found');
    expect(update).not.toHaveBeenCalled();
  });
});
