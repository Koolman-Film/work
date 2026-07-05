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

/**
 * Disputed check-ins awaiting review, branch-scoped to `permitted`.
 *
 * Extracted verbatim from `attendance/disputed/page.tsx` so the read is
 * unit-testable end-to-end. Scope (`viaEmployeeBranchScope`) is `{}` for a
 * global/Superadmin actor — byte-identical to the pre-scope query; a scoped
 * actor only sees disputes for employees in their branches (home ∪ assigned).
 */
export async function loadDisputedCheckIns(permitted: PermittedBranches): Promise<DisputedRow[]> {
  return prisma.attendance.findMany({
    where: {
      type: 'CheckIn',
      checkInStatus: { in: ['Disputed'] },
      ...viaEmployeeBranchScope(permitted),
    },
    orderBy: { clockInAt: 'desc' },
    take: 50,
    select: DISPUTED_SELECT,
  });
}
