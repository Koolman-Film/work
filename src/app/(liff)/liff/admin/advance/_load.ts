import 'server-only';

import type { Prisma } from '@prisma/client';
import { type PermittedBranches, viaEmployeeBranchScope } from '@/lib/auth/branch-scope';
import { prisma } from '@/lib/db/prisma';

/** Prisma select covering every field the awaiting-list row needs. */
export const AWAITING_SLIP_SELECT = {
  id: true,
  amount: true,
  approvedAt: true,
  paidAt: true,
  receiptUrl: true,
  employee: { select: { firstName: true, lastName: true, nickname: true } },
} satisfies Prisma.CashAdvanceSelect;

export type AwaitingSlipRow = Prisma.CashAdvanceGetPayload<{
  select: typeof AWAITING_SLIP_SELECT;
}>;

export type AwaitingSlipState = 'awaiting-payment' | 'awaiting-slip';

/**
 * Why a row is on this list: either it hasn't been paid yet, or it's been
 * paid but the slip is still missing. `paidAt === null` wins — a row still
 * needs a transfer before "which slip is missing" is even meaningful.
 */
export function awaitingSlipRowState(
  r: Pick<AwaitingSlipRow, 'paidAt' | 'receiptUrl'>,
): AwaitingSlipState {
  if (r.paidAt === null) return 'awaiting-payment';
  return r.receiptUrl === null ? 'awaiting-slip' : 'awaiting-payment';
}

/**
 * Read the "รอแนบสลิป" list — Approved advances that either still need a
 * transfer (`paidAt IS NULL`) OR have been paid but are still missing a
 * slip (`receiptUrl IS NULL`). Extracted from `page.tsx` so the query shape
 * is unit-testable (mirrors `[id]/_load.ts`).
 *
 * Before this widened OR, marking an advance paid without a slip (the
 * transfer-slip-optional change) set `paidAt` and the row silently fell out
 * of this list forever, with no other list showing "paid, no slip yet".
 */
export async function loadAwaitingSlipRows(
  permitted: PermittedBranches,
): Promise<AwaitingSlipRow[]> {
  return prisma.cashAdvance.findMany({
    where: {
      status: 'Approved',
      deletedAt: null,
      OR: [{ paidAt: null }, { receiptUrl: null }],
      ...viaEmployeeBranchScope(permitted),
    },
    orderBy: { approvedAt: 'desc' },
    take: 100,
    select: AWAITING_SLIP_SELECT,
  });
}
