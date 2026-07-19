/**
 * Reads the month's settlements for run.ts. Separate from penalty-settlement.ts
 * so that module stays pure and trivially testable.
 */

import { prisma } from '@/lib/db/prisma';
import { EMPTY_SETTLEMENT, type PenaltyKindKey, type SettlementDays } from './penalty-settlement';

/**
 * employeeId → what this month's penalties were settled with.
 *
 * `days` feeds the calculation, which is numeric and must stay so. The leave
 * type NAMES travel beside it rather than inside it because only the payslip
 * needs them — folding a display string into the arithmetic type would push
 * presentation into the money path for no benefit.
 */
export type MonthSettlement = {
  days: SettlementDays;
  leaveTypeNames: Partial<Record<PenaltyKindKey, string>>;
};

export async function loadSettlementsForMonth(
  month: string,
): Promise<Map<string, MonthSettlement>> {
  const rows = await prisma.attendancePenaltySettlement.findMany({
    where: { month, deletedAt: null },
    select: {
      employeeId: true,
      kind: true,
      days: true,
      leaveType: { select: { name: true } },
    },
  });

  const out = new Map<string, MonthSettlement>();
  for (const r of rows) {
    const cur = out.get(r.employeeId) ?? { days: { ...EMPTY_SETTLEMENT }, leaveTypeNames: {} };
    cur.days[r.kind] = Number(r.days);
    cur.leaveTypeNames[r.kind] = r.leaveType.name;
    out.set(r.employeeId, cur);
  }
  return out;
}
