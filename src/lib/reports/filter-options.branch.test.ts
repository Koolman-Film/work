/** Branch-scope of the report filter dropdown (Spec B5). */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Defensive: some report modules do `import 'server-only'`, which throws
// under the default vitest config. Mock it to a no-op so this stays a plain
// unit test regardless of what _load-filter-options.ts imports transitively.
vi.mock('server-only', () => ({}));

const branchFindMany = vi.fn(async (..._a: unknown[]) => [] as unknown[]);
const departmentFindMany = vi.fn(async (..._a: unknown[]) => [] as unknown[]);
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    branch: { findMany: (...a: unknown[]) => branchFindMany(...a) },
    department: { findMany: (...a: unknown[]) => departmentFindMany(...a) },
  },
}));

import { loadReportFilterOptions } from '@/app/(admin)/admin/reports/_load-filter-options';

const BRANCH_A = '00000000-0000-0000-0000-00000000000a';

describe('loadReportFilterOptions — branch scope', () => {
  beforeEach(() => vi.clearAllMocks());

  it('scoped actor: branch list limited to permitted ids', async () => {
    await loadReportFilterOptions([BRANCH_A]);
    expect(branchFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { archivedAt: null, id: { in: [BRANCH_A] } } }),
    );
  });

  it("global actor ('all'): branch list unfiltered", async () => {
    await loadReportFilterOptions('all');
    expect(branchFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { archivedAt: null } }),
    );
  });
});
