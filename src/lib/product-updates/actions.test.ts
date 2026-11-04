import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/admin-area', () => ({
  requireAdminArea: vi.fn(),
}));

vi.mock('./seen-store', () => ({
  addSeenIds: vi.fn(),
}));

import { requireAdminArea } from '@/lib/auth/admin-area';
import { markProductUpdatesSeen } from './actions';
import { addSeenIds } from './seen-store';

const mockedRequireAdminArea = vi.mocked(requireAdminArea);
const update = vi.mocked(addSeenIds);

function stubUser(id: string, seen: unknown) {
  // biome-ignore lint/suspicious/noExplicitAny: partial User shape for the gate
  mockedRequireAdminArea.mockResolvedValue({ user: { id, productUpdatesSeen: seen } } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('markProductUpdatesSeen', () => {
  it('sends only the ids the session does not already hold (the DB does the union)', async () => {
    stubUser('u1', ['a']);
    await markProductUpdatesSeen(['b', 'a', 'b']);
    expect(update).toHaveBeenCalledWith('u1', ['b']);
  });

  it('treats a null column as an empty set', async () => {
    stubUser('u1', null);
    await markProductUpdatesSeen(['first-run.welcome']);
    expect(update).toHaveBeenCalledWith('u1', ['first-run.welcome']);
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
