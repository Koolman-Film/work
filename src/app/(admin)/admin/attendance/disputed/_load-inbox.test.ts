/**
 * Unit tests for loadDisputedCheckIns — the disputed-inbox reader.
 *
 * Guards two things:
 *  1. The row cap (INBOX_LIMIT) doesn't hide the true total — the caller
 *     needs `total` to reconcile with the sidebar badge count.
 *  2. The count query and the findMany query see the SAME `where` object
 *     (reference identity, not just deep-equal content) — this is the
 *     regression guard for the bug where the badge (unbounded count()) and
 *     the list (take: 50, no count) drifted apart. `toEqual` would still
 *     pass if the loader were refactored to build two separate-but-
 *     currently-identical `where` literals; only `toBe` catches that,
 *     because it fails the moment the two stop being literally one object,
 *     which is exactly the "ONE where object feeding both queries" property
 *     the loader's own comment promises.
 *
 * prisma is mocked at the module boundary (same style as
 * src/lib/advance/mark-paid.test.ts), with $transaction handling the
 * array form: `prisma.$transaction([findManyPromise, countPromise])`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const findManyMock = vi.fn();
const countMock = vi.fn();

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    attendance: {
      findMany: (...a: unknown[]) => findManyMock(...a),
      count: (...a: unknown[]) => countMock(...a),
    },
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops)),
  },
}));

import { loadDisputedCheckIns } from './_load-inbox';

const row = { id: 'att-1' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadDisputedCheckIns', () => {
  it('returns the total even when rows are capped at 50', async () => {
    findManyMock.mockResolvedValue(new Array(50).fill(row));
    countMock.mockResolvedValue(137);

    const result = await loadDisputedCheckIns('all');

    expect(result.rows).toHaveLength(50);
    expect(result.total).toBe(137);
  });

  it('uses the SAME where object (reference identity) for the rows query and the count', async () => {
    findManyMock.mockResolvedValue([]);
    countMock.mockResolvedValue(0);

    await loadDisputedCheckIns('all');

    expect(countMock.mock.calls[0]![0]!.where).toBe(findManyMock.mock.calls[0]![0]!.where);
  });
});
