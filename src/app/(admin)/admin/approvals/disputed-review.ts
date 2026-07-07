'use server';

/**
 * Single-record fetch for the disputed-check-in review pane on
 * `/admin/approvals`. Mirrors `getLeaveReviewRow`/`getAdvanceReviewRow` in
 * `_calendar/actions.ts` — gated by the same permission as the disputed
 * approve/reject actions, branch-scoped via `viaEmployeeBranchScope`.
 */

import { DISPUTED_SELECT } from '@/app/(admin)/admin/attendance/disputed/_load-inbox';
import { getPermittedBranches, viaEmployeeBranchScope } from '@/lib/auth/branch-scope';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { haversineMeters } from '@/lib/geo/distance';
import { resolveStoredImageUrl } from '@/lib/storage/signed-urls';

export type DisputedReviewVM = {
  id: string;
  name: string;
  nickname: string | null;
  branch: string;
  clockInLabel: string;
  distanceMeters: number | null;
  reason: string;
  selfieUrl: string | null;
};

export async function getDisputedReviewRow(attendanceId: string): Promise<DisputedReviewVM | null> {
  const { user } = await requirePermission('attendance.dispute-resolve');
  const permitted = await getPermittedBranches(user, 'attendance.dispute-resolve');
  const r = await prisma.attendance.findFirst({
    where: {
      id: attendanceId,
      type: 'CheckIn',
      checkInStatus: 'Disputed',
      ...viaEmployeeBranchScope(permitted),
    },
    select: DISPUTED_SELECT,
  });
  if (!r) return null;

  // Distance is only computable when the check-in has both coordinates AND
  // the branch it was scoped to still has a configured geofence pin — either
  // can be null (unconfigured branch, or an admin-cleared pin). Do NOT call
  // haversineMeters with a null operand; mirrors `mapDisputedCard` in
  // `src/lib/approvals/cards.ts` and `attendance/disputed/page.tsx`.
  const distanceMeters =
    r.checkInBranch !== null &&
    r.checkInBranch.latitude !== null &&
    r.checkInBranch.longitude !== null &&
    r.checkInLat !== null &&
    r.checkInLng !== null
      ? haversineMeters(
          Number(r.checkInLat),
          Number(r.checkInLng),
          Number(r.checkInBranch.latitude),
          Number(r.checkInBranch.longitude),
        )
      : null;

  return {
    id: r.id,
    name: `${r.employee.firstName} ${r.employee.lastName}`,
    nickname: r.employee.nickname,
    branch: r.employee.branch.name,
    clockInLabel: r.clockInAt
      ? r.clockInAt.toLocaleString('th-TH', {
          timeZone: 'Asia/Bangkok',
          hour: '2-digit',
          minute: '2-digit',
          day: 'numeric',
          month: 'short',
        })
      : '—',
    distanceMeters,
    reason: r.disputeReason ?? 'ไม่ระบุ',
    selfieUrl: await resolveStoredImageUrl(r.checkInSelfieUrl),
  };
}
