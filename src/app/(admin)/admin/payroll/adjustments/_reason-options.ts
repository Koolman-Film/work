import { prisma } from '@/lib/db/prisma';

/** Previously-used adjustment reasons, grouped by kind — fed into the form's
 *  combobox so admin-added reasons resurface as suggestions next time. */
export type ReasonSuggestions = { Income: string[]; Deduction: string[] };

export async function loadReasonSuggestions(): Promise<ReasonSuggestions> {
  const rows = await prisma.payrollAdjustment.groupBy({
    by: ['kind', 'reason'],
    where: { deletedAt: null },
    orderBy: { reason: 'asc' },
  });
  const out: ReasonSuggestions = { Income: [], Deduction: [] };
  for (const r of rows) out[r.kind].push(r.reason);
  return out;
}
