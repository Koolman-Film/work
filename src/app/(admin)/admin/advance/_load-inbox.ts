import 'server-only';

import type { Prisma } from '@prisma/client';
import { type PermittedBranches, viaEmployeeBranchScope } from '@/lib/auth/branch-scope';
import { prisma, prismaRaw } from '@/lib/db/prisma';
import { ADVANCE_SELECT } from './advance-row-vm';

export type AdvanceInboxRow = Prisma.CashAdvanceGetPayload<{ select: typeof ADVANCE_SELECT }>;

/**
 * Read a page of the cash-advance inbox (or trash), branch-scoped to `permitted`.
 *
 * Extracted verbatim from `advance/page.tsx` so the read path is unit-testable
 * end-to-end (mirrors `leave/_load-inbox.ts`). Live inbox uses `prisma`
 * (soft-delete filtered); trash uses `prismaRaw`. Scope (`viaEmployeeBranchScope`)
 * is `{}` for a global/Superadmin actor — byte-identical to the pre-scope query;
 * a scoped actor only sees advances for employees in their branches. `count`
 * mirrors `findMany`'s `where` exactly so the pager total is correct.
 */
export async function loadAdvanceInbox(args: {
  permitted: PermittedBranches;
  /** '' | 'all' | 'approved' | 'rejected' — anything else ⇒ Pending (default). */
  status?: string;
  /** Employee-name search; narrows the status view. */
  q?: string;
  isTrash: boolean;
  skip: number;
  take: number;
}): Promise<{ rows: AdvanceInboxRow[]; total: number }> {
  const { permitted, status, q, isTrash, skip, take } = args;
  const scope = viaEmployeeBranchScope(permitted); // {} for 'all' (global/Superadmin)

  // Status filter → base where; an employee-name search (q) narrows on top.
  const where: Prisma.CashAdvanceWhereInput = (() => {
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

  // Branch scope: a scoped admin only sees advances for employees in their branches.
  if (scope.employee) {
    where.employee = where.employee ? { AND: [where.employee, scope.employee] } : scope.employee;
  }

  const trashWhere: Prisma.CashAdvanceWhereInput = { deletedAt: { not: null } };
  if (scope.employee) trashWhere.employee = scope.employee;

  const [rows, total] = await Promise.all([
    isTrash
      ? prismaRaw.cashAdvance.findMany({
          where: trashWhere,
          orderBy: { deletedAt: 'desc' },
          skip,
          take,
          select: ADVANCE_SELECT,
        })
      : prisma.cashAdvance.findMany({
          where,
          orderBy: { requestedAt: 'desc' },
          skip,
          take,
          select: ADVANCE_SELECT,
        }),
    isTrash
      ? prismaRaw.cashAdvance.count({ where: trashWhere })
      : prisma.cashAdvance.count({ where }),
  ]);
  return { rows, total };
}
