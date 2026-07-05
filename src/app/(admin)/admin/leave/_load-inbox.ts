import 'server-only';

import type { Prisma } from '@prisma/client';
import { type PermittedBranches, viaEmployeeBranchScope } from '@/lib/auth/branch-scope';
import { prisma, prismaRaw } from '@/lib/db/prisma';
import { LEAVE_SELECT } from './leave-row-vm';

export type LeaveInboxRow = Prisma.LeaveRequestGetPayload<{ select: typeof LEAVE_SELECT }>;

/**
 * Read a page of the leave inbox (or trash), branch-scoped to `permitted`.
 *
 * Extracted verbatim from `leave/page.tsx` so the read path is unit-testable
 * end-to-end (seed a scoped admin + multi-branch data, assert only in-scope
 * rows return) rather than only reachable by rendering the server component.
 *
 * - Live inbox uses `prisma` (soft-delete filtered); trash uses `prismaRaw`
 *   (sees soft-deleted rows), matching the page.
 * - Branch scope (`viaEmployeeBranchScope`) is `{}` for a global/Superadmin
 *   actor, so their result is byte-identical to the pre-scope query. A scoped
 *   actor only sees leave for employees in their branches (home ∪ assigned).
 * - `count` mirrors `findMany`'s `where` exactly so the pager total is correct.
 */
export async function loadLeaveInbox(args: {
  permitted: PermittedBranches;
  /** '' | 'all' | 'approved' | 'rejected' — anything else ⇒ Pending (default). */
  status?: string;
  /** Employee-name search; narrows the status view. */
  q?: string;
  isTrash: boolean;
  skip: number;
  take: number;
}): Promise<{ rows: LeaveInboxRow[]; total: number }> {
  const { permitted, status, q, isTrash, skip, take } = args;
  const scope = viaEmployeeBranchScope(permitted); // {} for 'all' (global/Superadmin)

  // Status filter → base where; an employee-name search (q) narrows on top.
  const where: Prisma.LeaveRequestWhereInput = (() => {
    if (status === 'all') return {};
    if (status === 'approved') return { status: 'Approved' };
    if (status === 'rejected') return { status: 'Rejected' };
    return { status: 'Pending' };
  })();
  if (q) {
    where.employee = {
      OR: [
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
        { nickname: { contains: q, mode: 'insensitive' } },
      ],
    };
  }

  // Branch scope: a scoped admin only sees leave for employees in their branches.
  // Merge with any name-search `where.employee` via AND so both apply.
  if (scope.employee) {
    where.employee = where.employee ? { AND: [where.employee, scope.employee] } : scope.employee;
  }

  const trashWhere: Prisma.LeaveRequestWhereInput = { deletedAt: { not: null } };
  if (scope.employee) trashWhere.employee = scope.employee;

  // The page of rows + the matching total (for the pager) go through the same
  // client: trash reads use prismaRaw (sees soft-deleted), the live inbox uses
  // the soft-delete-filtered prisma. count mirrors findMany's where exactly.
  const [rows, total] = await Promise.all([
    isTrash
      ? prismaRaw.leaveRequest.findMany({
          where: trashWhere,
          orderBy: { deletedAt: 'desc' },
          skip,
          take,
          select: LEAVE_SELECT,
        })
      : prisma.leaveRequest.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take,
          select: LEAVE_SELECT,
        }),
    isTrash
      ? prismaRaw.leaveRequest.count({ where: trashWhere })
      : prisma.leaveRequest.count({ where }),
  ]);
  return { rows, total };
}
