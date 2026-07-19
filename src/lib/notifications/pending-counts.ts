import 'server-only';

import { permittedBranchesFromAssignments, viaEmployeeBranchScope } from '@/lib/auth/branch-scope';
import type { AssignmentForCheck } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';

/**
 * The three "pending-work" counts, branch-scoped per domain.
 *
 * Shared by the sidebar badges (`(admin)/_load-badge-counts.ts` re-exports
 * this under its old name) and the admin daily-digest cron
 * (`inngest/functions/admin-daily-digest.ts`) — a single source of truth so
 * the two can never disagree about what's "pending" for a given admin.
 *
 * Each is scoped by its own domain permission off the actor's
 * `assignments`; the scope fragment is `{}` for a global actor, so their
 * counts are byte-identical to the pre-scope query.
 */
export async function loadPendingCounts(
  assignments: ReadonlyArray<AssignmentForCheck>,
): Promise<{ leave: number; advance: number; attendance: number }> {
  const leaveScope = viaEmployeeBranchScope(
    permittedBranchesFromAssignments(assignments, 'leave.read'),
  );
  const advScope = viaEmployeeBranchScope(
    permittedBranchesFromAssignments(assignments, 'advance.read'),
  );
  const attScope = viaEmployeeBranchScope(
    permittedBranchesFromAssignments(assignments, 'attendance.read'),
  );

  const [leave, advance, attendance] = await Promise.all([
    prisma.leaveRequest.count({ where: { status: 'Pending', ...leaveScope } }),
    prisma.cashAdvance.count({ where: { status: 'Pending', ...advScope } }),
    prisma.attendance.count({ where: { type: 'CheckIn', checkInStatus: 'Disputed', ...attScope } }),
  ]);
  return { leave, advance, attendance };
}
