/**
 * The cash-advance window must be Bangkok-aligned, because the grid anchor is.
 *
 * `CashAdvance.requestedAt` is a TIMESTAMP, and the loader anchors each row to
 * a day cell by its Bangkok date. The window used to be UTC-midnight bounds,
 * so the two disagreed for the 7 hours after Bangkok midnight and rows in that
 * seam disappeared: an advance created at 00:25 Bangkok on 1 August is
 * 2026-07-31T17:25Z, which UTC bounds fetch under JULY while the anchor puts it
 * on 1 August — a cell July's grid does not contain. Invisible in both months.
 *
 * Asserted on the query rather than through the database because the bug is
 * the bounds themselves; this pins them exactly, at any time of day.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const EMPLOYEE = {
  id: '00000000-0000-0000-0000-0000000000e1',
  firstName: 'A',
  lastName: 'B',
  nickname: null,
  branchId: '00000000-0000-0000-0000-00000000000a',
  assignedBranchIds: [],
  dateOfBirth: null,
};

const cashAdvanceFindMany = vi.fn(async (..._a: unknown[]) => [] as unknown[]);
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    employee: { findMany: vi.fn(async () => [EMPLOYEE]) },
    holiday: { findMany: vi.fn(async () => []) },
    leaveRequest: { findMany: vi.fn(async () => []) },
    cashAdvance: { findMany: (...a: unknown[]) => cashAdvanceFindMany(...a) },
  },
}));

import { getOrgCalendarData } from './team-calendar';

/** The requestedAt filter the loader asked Prisma for. */
function requestedAtFilter(): { gte: Date; lt: Date } {
  const arg = cashAdvanceFindMany.mock.calls[0]?.[0] as {
    where: { requestedAt: { gte: Date; lt: Date } };
  };
  return arg.where.requestedAt;
}

describe('getOrgCalendarData — advance window', () => {
  it('starts and ends the month at Bangkok midnight, not UTC midnight', async () => {
    cashAdvanceFindMany.mockClear();

    await getOrgCalendarData({
      monthStart: new Date('2026-08-01T00:00:00.000Z'),
      monthEnd: new Date('2026-08-31T00:00:00.000Z'),
      permitted: 'all',
    });

    const { gte, lt } = requestedAtFilter();
    expect(gte.toISOString()).toBe('2026-07-31T17:00:00.000Z');
    expect(lt.toISOString()).toBe('2026-08-31T17:00:00.000Z');
  });

  it('includes an advance made in the first Bangkok hours of the month', async () => {
    cashAdvanceFindMany.mockClear();

    await getOrgCalendarData({
      monthStart: new Date('2026-08-01T00:00:00.000Z'),
      monthEnd: new Date('2026-08-31T00:00:00.000Z'),
      permitted: 'all',
    });

    const { gte, lt } = requestedAtFilter();
    // 00:25 Bangkok on 1 Aug — the exact shape that used to vanish.
    const seam = new Date('2026-07-31T17:25:00.000Z');
    expect(seam >= gte && seam < lt).toBe(true);
  });

  it('excludes the last Bangkok moments of the previous month', async () => {
    cashAdvanceFindMany.mockClear();

    await getOrgCalendarData({
      monthStart: new Date('2026-08-01T00:00:00.000Z'),
      monthEnd: new Date('2026-08-31T00:00:00.000Z'),
      permitted: 'all',
    });

    const { gte, lt } = requestedAtFilter();
    // 23:59 Bangkok on 31 July still belongs to July.
    const stillJuly = new Date('2026-07-31T16:59:00.000Z');
    expect(stillJuly < gte).toBe(true);
    // 00:30 Bangkok on 1 September belongs to September.
    const alreadySeptember = new Date('2026-08-31T17:30:00.000Z');
    expect(alreadySeptember >= lt).toBe(true);
  });
});
