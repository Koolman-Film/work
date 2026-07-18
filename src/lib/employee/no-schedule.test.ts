/**
 * Unit tests: employeesWithoutSchedule — shared query for employees missing
 * a WorkSchedule assignment.
 *
 * Strategy: mock @/lib/db/prisma and @/lib/auth/branch-scope's
 * employeeBranchScope, then call the REAL function and assert both the
 * returned shape and the exact `where` Prisma was called with.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// no-schedule.ts does `import 'server-only'`, which throws under the default
// vitest config (no react-server condition / alias). Mock it to a no-op so
// this stays a plain unit test.
vi.mock('server-only', () => ({}));

// ── prisma mock ──────────────────────────────────────────────────────────────
const employeeFindMany = vi.fn();

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    employee: {
      findMany: (...a: unknown[]) => employeeFindMany(...a),
    },
  },
}));

import { employeeBranchScope, type PermittedBranches } from '@/lib/auth/branch-scope';
import { employeesWithoutSchedule } from './no-schedule';

describe('employeesWithoutSchedule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps rows to EmployeeMissingSchedule, preferring nickname over full name', async () => {
    employeeFindMany.mockResolvedValue([
      {
        id: 'emp-1',
        firstName: 'สมชาย',
        lastName: 'ใจดี',
        nickname: 'ชาย',
        branch: { name: 'สาขา A' },
      },
      {
        id: 'emp-2',
        firstName: 'สมหญิง',
        lastName: 'มั่นคง',
        nickname: null,
        branch: { name: 'สาขา B' },
      },
    ]);

    const result = await employeesWithoutSchedule('all');

    expect(result).toEqual([
      { id: 'emp-1', name: 'ชาย', branchName: 'สาขา A' },
      { id: 'emp-2', name: 'สมหญิง มั่นคง', branchName: 'สาขา B' },
    ]);
  });

  it('returns [] when no employee matches', async () => {
    employeeFindMany.mockResolvedValue([]);

    const result = await employeesWithoutSchedule('all');

    expect(result).toEqual([]);
  });

  it('queries only active + canCheckIn + workScheduleId:null employees, scoped by branch', async () => {
    employeeFindMany.mockResolvedValue([]);
    const permitted: PermittedBranches = ['branch-A'];

    await employeesWithoutSchedule(permitted);

    expect(employeeFindMany).toHaveBeenCalledOnce();
    const args = employeeFindMany.mock.calls[0]?.[0];
    expect(args.where).toEqual({
      archivedAt: null,
      status: { not: 'Archived' },
      canCheckIn: true,
      workScheduleId: null,
      ...employeeBranchScope(permitted),
    });
  });

  it('passes employeeBranchScope(permitted) through to the where clause so a scoped admin cannot see other branches', async () => {
    employeeFindMany.mockResolvedValue([]);
    const permitted: PermittedBranches = ['branch-A', 'branch-B'];

    await employeesWithoutSchedule(permitted);

    const args = employeeFindMany.mock.calls[0]?.[0];
    expect(args.where.OR).toEqual([
      { branchId: { in: permitted } },
      { assignedBranchIds: { hasSome: permitted } },
    ]);
  });

  it('excludes archived, non-check-in, and already-scheduled employees via the where clause (not post-filtering)', async () => {
    // The implementation must delegate exclusion to Prisma's `where` — we
    // assert the exact filter fields rather than passing "bad" rows through
    // and hoping the function filters them out in JS.
    employeeFindMany.mockResolvedValue([]);

    await employeesWithoutSchedule('all');

    const args = employeeFindMany.mock.calls[0]?.[0];
    expect(args.where.archivedAt).toBe(null);
    expect(args.where.status).toEqual({ not: 'Archived' });
    expect(args.where.canCheckIn).toBe(true);
    expect(args.where.workScheduleId).toBe(null);
  });
});
