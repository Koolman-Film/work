import 'server-only';

import type { Prisma } from '@prisma/client';
import { type PermittedBranches, viaEmployeeBranchScope } from '@/lib/auth/branch-scope';
import { prisma } from '@/lib/db/prisma';

const ADVANCE_DETAIL_SELECT = {
  id: true,
  employeeId: true,
  amount: true,
  status: true,
  requestedAt: true,
  approvedAt: true,
  paidAt: true,
  receiptUrl: true,
  isDeducted: true,
  deletedAt: true,
  employee: { select: { firstName: true, lastName: true, nickname: true } },
} satisfies Prisma.CashAdvanceSelect;

export type LiffAdvanceDetail = Prisma.CashAdvanceGetPayload<{
  select: typeof ADVANCE_DETAIL_SELECT;
}>;

/**
 * One cash-advance for the LIFF detail page, branch-scoped to `permitted`.
 *
 * Extracted verbatim from `liff/admin/advance/[id]/page.tsx`. The scope is
 * merged into the `findFirst` `where` alongside the `id`, so an out-of-branch
 * advance returns `null` (the page then calls `notFound()`) — a branch admin
 * cannot open an out-of-scope record by guessing its id. `{}` for a global
 * actor, so their lookup is by-id only, as before.
 */
export async function loadLiffAdvanceDetail(
  id: string,
  permitted: PermittedBranches,
): Promise<LiffAdvanceDetail | null> {
  return prisma.cashAdvance.findFirst({
    where: { id, ...viaEmployeeBranchScope(permitted) },
    select: ADVANCE_DETAIL_SELECT,
  });
}
