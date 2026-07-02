/** Branch-scope of getOrgCalendarData's employee set (Spec B6). */
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const employeeFindMany = vi.fn(async (..._a: unknown[]) => [] as unknown[]);
const holidayFindMany = vi.fn(async (..._a: unknown[]) => [] as unknown[]);
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    employee: { findMany: (...a: unknown[]) => employeeFindMany(...a) },
    holiday: { findMany: (...a: unknown[]) => holidayFindMany(...a) },
    leaveRequest: { findMany: vi.fn(async () => []) },
    cashAdvance: { findMany: vi.fn(async () => []) },
  },
}));

import { getOrgCalendarData } from './team-calendar';

const BRANCH_A = '00000000-0000-0000-0000-00000000000a';
const M = { monthStart: new Date('2026-07-01'), monthEnd: new Date('2026-07-31') };

describe('getOrgCalendarData — permission branch scope', () => {
  it('scoped actor: AND-combines the base employee filter with employeeBranchScope', async () => {
    await getOrgCalendarData({ ...M, permitted: [BRANCH_A] });
    expect(employeeFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { archivedAt: null, status: { not: 'Archived' } },
            {
              OR: [
                { branchId: { in: [BRANCH_A] } },
                { assignedBranchIds: { hasSome: [BRANCH_A] } },
              ],
            },
          ],
        },
      }),
    );
  });

  it("global actor ('all'): plain base filter, no AND wrapper", async () => {
    employeeFindMany.mockClear();
    await getOrgCalendarData({ ...M, permitted: 'all' });
    expect(employeeFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { archivedAt: null, status: { not: 'Archived' } } }),
    );
  });

  it("user branchId filter still AND's the permitted scope", async () => {
    employeeFindMany.mockClear();
    await getOrgCalendarData({ ...M, branchId: BRANCH_A, permitted: [BRANCH_A] });
    const call = employeeFindMany.mock.calls[0];
    const arg = call?.[0] as { where: { AND: unknown[] } };
    expect(arg.where.AND).toHaveLength(2);
    expect(arg.where.AND[0]).toMatchObject({
      OR: [{ branchId: BRANCH_A }, { assignedBranchIds: { hasSome: [BRANCH_A] } }],
    });
  });
});
