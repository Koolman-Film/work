/**
 * Minutes of leave entitlement consumed by attendance penalties an admin chose
 * to settle with leave. The mirror of usedMinutes (balance.ts): same shape,
 * same year bucketing, different source table.
 *
 * Two variants because the balance module reads two ways — per-type inside a
 * loop, and one grouped query for report pages. Each caller uses the variant
 * matching how it already fetches `used`, so this adds no new query pattern.
 */

import { prisma } from '@/lib/db/prisma';

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Penalty minutes for one employee, one leave type, one leave year. */
export async function penaltyMinutes(
  employeeId: string,
  leaveTypeId: string,
  year: number,
  db: TxClient = prisma,
): Promise<number> {
  const rows = await db.attendancePenaltySettlement.findMany({
    where: { employeeId, leaveTypeId, periodYear: year, deletedAt: null },
    select: { minutes: true },
  });
  return rows.reduce((sum, r) => sum + r.minutes, 0);
}

/** Bulk variant for report pages. Key: `${employeeId}:${leaveTypeId}`. */
export async function penaltyMinutesBy(
  employeeIds: readonly string[],
  year: number,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (employeeIds.length === 0) return out;

  const grouped = await prisma.attendancePenaltySettlement.groupBy({
    by: ['employeeId', 'leaveTypeId'],
    where: { employeeId: { in: [...employeeIds] }, periodYear: year, deletedAt: null },
    _sum: { minutes: true },
  });
  for (const g of grouped) {
    out.set(`${g.employeeId}:${g.leaveTypeId}`, g._sum.minutes ?? 0);
  }
  return out;
}
