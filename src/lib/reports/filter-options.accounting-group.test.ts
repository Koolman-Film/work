/** Account-group filter dropdown options for the payroll page. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Defensive: _load-filter-options.ts pulls in `server-only` transitively,
// which throws under the default vitest config. Mock it to a no-op so this
// stays a plain unit test. (Same guard as filter-options.branch.test.ts.)
vi.mock('server-only', () => ({}));

const accountingGroupFindMany = vi.fn(async (..._a: unknown[]) => [] as unknown[]);
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    accountingGroup: { findMany: (...a: unknown[]) => accountingGroupFindMany(...a) },
  },
}));

import { loadAccountingGroupOptions } from '@/app/(admin)/admin/reports/_load-filter-options';

describe('loadAccountingGroupOptions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists active (non-archived) groups ordered by name, selecting id + name', async () => {
    await loadAccountingGroupOptions();
    expect(accountingGroupFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { archivedAt: null },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
    );
  });

  it('returns the rows as {id, name} filter options', async () => {
    accountingGroupFindMany.mockResolvedValueOnce([
      { id: 'g1', name: 'ค่าใช้จ่ายบริษัท' },
      { id: 'g2', name: 'จ่ายแทน-รับคืน' },
    ]);
    expect(await loadAccountingGroupOptions()).toEqual([
      { id: 'g1', name: 'ค่าใช้จ่ายบริษัท' },
      { id: 'g2', name: 'จ่ายแทน-รับคืน' },
    ]);
  });
});
