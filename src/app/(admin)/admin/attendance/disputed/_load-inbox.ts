import 'server-only';

import type { Prisma } from '@prisma/client';
import { type PermittedBranches, viaEmployeeBranchScope } from '@/lib/auth/branch-scope';
import { prisma } from '@/lib/db/prisma';

/** Prisma select covering every field the DisputedVM builder reads. */
export const DISPUTED_SELECT = {
  id: true,
  clockInAt: true,
  checkInLat: true,
  checkInLng: true,
  disputeReason: true,
  checkInSelfieUrl: true,
  checkInBranch: {
    select: { name: true, latitude: true, longitude: true, radiusMeters: true },
  },
  employee: {
    select: {
      firstName: true,
      lastName: true,
      nickname: true,
      branch: { select: { name: true } },
      department: { select: { name: true } },
    },
  },
} satisfies Prisma.AttendanceSelect;

export type DisputedRow = Prisma.AttendanceGetPayload<{ select: typeof DISPUTED_SELECT }>;

export type DisputedInbox = { rows: DisputedRow[]; total: number };

/** Cap on rows returned in one page of the inbox. */
const INBOX_LIMIT = 50;

/**
 * Disputed check-ins awaiting review, branch-scoped to `permitted`.
 *
 * Extracted verbatim from `attendance/disputed/page.tsx` so the read is
 * unit-testable end-to-end. Scope (`viaEmployeeBranchScope`) is `{}` for a
 * global/Superadmin actor — byte-identical to the pre-scope query; a scoped
 * actor only sees disputes for employees in their branches (home ∪ assigned).
 *
 * Returns `total` alongside the capped `rows` so the caller can reconcile
 * against the sidebar badge (an unbounded count) instead of silently
 * truncating past INBOX_LIMIT.
 */
export async function loadDisputedCheckIns(permitted: PermittedBranches): Promise<DisputedInbox> {
  // ONE where object feeding both queries. Declaring it twice is exactly how
  // the badge count and this list drifted apart in the first place.
  const where = {
    type: 'CheckIn' as const,
    checkInStatus: { in: ['Disputed' as const] },
    ...viaEmployeeBranchScope(permitted),
  };

  const [rows, total] = await prisma.$transaction([
    prisma.attendance.findMany({
      where,
      orderBy: { clockInAt: 'desc' },
      take: INBOX_LIMIT,
      select: DISPUTED_SELECT,
    }),
    prisma.attendance.count({ where }),
  ]);

  return { rows, total };
}
