/**
 * Branch-scope enforcement for report queries (Spec B5).
 * Tests the exported `employeeWhere` (the single injection point) directly,
 * plus one threading test proving advanceReport passes `permitted` through.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// queries.ts does `import 'server-only'`, which throws under the default
// vitest config (no react-server condition / alias). Mock it to a no-op so
// this stays a plain unit test. (The integration config aliases it instead.)
vi.mock('server-only', () => ({}));

const employeeFindMany = vi.fn(async (..._a: unknown[]) => [] as unknown[]);
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    employee: { findMany: (...a: unknown[]) => employeeFindMany(...a) },
    cashAdvance: { groupBy: vi.fn(async () => [] as unknown[]) },
  },
}));
vi.mock('@/lib/advance/available', () => ({
  advanceBalanceFor: vi.fn(async () => ({ available: 0 })),
}));

import { advanceReport, employeeWhere } from './queries';

const BRANCH_A = '00000000-0000-0000-0000-00000000000a';
const BRANCH_B = '00000000-0000-0000-0000-00000000000b';

describe('employeeWhere — permission branch scope', () => {
  it('scoped actor: AND-combines the user filter with employeeBranchScope', () => {
    const w = employeeWhere({ branchId: BRANCH_A }, [BRANCH_A]);
    expect(w).toEqual({
      AND: [
        { archivedAt: null, branchId: BRANCH_A },
        { OR: [{ branchId: { in: [BRANCH_A] } }, { assignedBranchIds: { hasSome: [BRANCH_A] } }] },
      ],
    });
  });

  it("forged out-of-scope filter still AND's the permitted scope", () => {
    const w = employeeWhere({ branchId: BRANCH_B }, [BRANCH_A]); // user asks for B, only permitted A
    expect(w).toMatchObject({
      AND: [
        { branchId: BRANCH_B },
        { OR: [{ branchId: { in: [BRANCH_A] } }, { assignedBranchIds: { hasSome: [BRANCH_A] } }] },
      ],
    });
  });

  it("global actor ('all'): plain user filter, no AND wrapper", () => {
    const w = employeeWhere({ branchId: BRANCH_A }, 'all');
    expect(w).toEqual({ archivedAt: null, branchId: BRANCH_A });
    expect(w).not.toHaveProperty('AND');
  });

  it("empty permitted []: AND's the match-nothing scope", () => {
    const w = employeeWhere({}, []);
    expect(w).toEqual({ AND: [{ archivedAt: null }, { id: { in: [] } }] });
  });
});

describe('advanceReport — threads permitted into the employee query', () => {
  beforeEach(() => vi.clearAllMocks());
  it('calls prisma.employee.findMany with the scoped where', async () => {
    await advanceReport({ from: '2026-06-01', to: '2026-06-30' }, { branchId: BRANCH_A }, [
      BRANCH_A,
    ]);
    expect(employeeFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: employeeWhere({ branchId: BRANCH_A }, [BRANCH_A]) }),
    );
  });
});
