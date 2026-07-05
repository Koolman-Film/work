import 'server-only';

import type { Prisma } from '@prisma/client';
import { LEAVE_SELECT } from '@/app/(admin)/admin/leave/leave-row-vm';
import { type PermittedBranches, viaEmployeeBranchScope } from '@/lib/auth/branch-scope';
import { prisma } from '@/lib/db/prisma';

export type LiffLeaveDetail = Prisma.LeaveRequestGetPayload<{ select: typeof LEAVE_SELECT }>;

/**
 * One leave request for the LIFF detail page, branch-scoped to `permitted`.
 *
 * Extracted verbatim from `liff/admin/leave/[id]/page.tsx`. The scope is merged
 * into the `findFirst` `where` alongside the `id`, so an out-of-branch request
 * returns `null` (the page then calls `notFound()`). `{}` for a global actor.
 */
export async function loadLiffLeaveDetail(
  id: string,
  permitted: PermittedBranches,
): Promise<LiffLeaveDetail | null> {
  return prisma.leaveRequest.findFirst({
    where: { id, ...viaEmployeeBranchScope(permitted) },
    select: LEAVE_SELECT,
  });
}
