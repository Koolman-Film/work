/** Branch-scope enforcement for overtime (Spec B-OT). */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const attendanceFindMany = vi.fn(async (..._a: unknown[]) => [] as unknown[]);
const otFindMany = vi.fn(async (..._a: unknown[]) => [] as unknown[]);
const payrollConfigFindFirst = vi.fn(async (..._a: unknown[]) => ({ otThresholdMinutes: 30 }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    attendance: { findMany: (...a: unknown[]) => attendanceFindMany(...a) },
    overtimeEntry: { findMany: (...a: unknown[]) => otFindMany(...a) },
    payrollConfig: { findFirst: (...a: unknown[]) => payrollConfigFindFirst(...a) },
  },
}));

import { getOtCandidates } from './candidates';

const BRANCH_A = '00000000-0000-0000-0000-00000000000a';

describe('getOtCandidates — branch scope', () => {
  beforeEach(() => vi.clearAllMocks());

  it('scoped actor: attendance query carries the employee branch scope', async () => {
    await getOtCandidates({ ym: '2026-07' }, [BRANCH_A]);
    expect(attendanceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          employee: { OR: [{ branchId: { in: [BRANCH_A] } }, { assignedBranchIds: { hasSome: [BRANCH_A] } }] },
        }),
      }),
    );
  });

  it("global actor ('all'): no employee scope added", async () => {
    await getOtCandidates({ ym: '2026-07' }, 'all');
    const arg = attendanceFindMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(arg.where).not.toHaveProperty('employee');
  });
});
