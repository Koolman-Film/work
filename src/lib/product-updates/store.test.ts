import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({
  markProductUpdatesSeen: vi.fn().mockResolvedValue(undefined),
}));

import { markProductUpdatesSeen } from './actions';
import { useProductUpdates } from './store';

const mockedMark = vi.mocked(markProductUpdatesSeen);

beforeEach(() => {
  vi.clearAllMocks();
  // Reset store to initial state between tests.
  useProductUpdates.setState({ seen: new Set(), hydrated: false });
});

describe('useProductUpdates store', () => {
  it('hydrate(initialSeen) seeds the seen set and flips hydrated', () => {
    useProductUpdates.getState().hydrate(['a', 'first-run.welcome']);
    const s = useProductUpdates.getState();
    expect(s.hydrated).toBe(true);
    expect([...s.seen].sort()).toEqual(['a', 'first-run.welcome']);
  });

  it('hydrate is idempotent (second call does not overwrite)', () => {
    const store = useProductUpdates.getState();
    store.hydrate(['a']);
    store.hydrate(['b']);
    expect([...useProductUpdates.getState().seen]).toEqual(['a']);
  });

  it('markSeen adds locally and calls the server action', () => {
    useProductUpdates.getState().markSeen('x');
    expect(useProductUpdates.getState().seen.has('x')).toBe(true);
    expect(mockedMark).toHaveBeenCalledWith(['x']);
  });

  it('markManySeen adds all locally and calls the server action once', () => {
    useProductUpdates.getState().markManySeen(['x', 'y']);
    const seen = useProductUpdates.getState().seen;
    expect(seen.has('x')).toBe(true);
    expect(seen.has('y')).toBe(true);
    expect(mockedMark).toHaveBeenCalledWith(['x', 'y']);
  });
});
