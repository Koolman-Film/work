import 'server-only';

import type { Prisma } from '@prisma/client';
import { ADVANCE_SELECT } from '@/app/(admin)/admin/advance/advance-row-vm';
import { DISPUTED_SELECT } from '@/app/(admin)/admin/attendance/disputed/_load-inbox';
import { LEAVE_SELECT } from '@/app/(admin)/admin/leave/leave-row-vm';
import type { AssignmentForCheck } from '@/lib/auth/branch-scope';
import { permittedBranchesFromAssignments, viaEmployeeBranchScope } from '@/lib/auth/branch-scope';
import { prisma } from '@/lib/db/prisma';
import {
  type ApprovalCard,
  type ApprovalFilters,
  filterApprovalCards,
  mapAdvanceCard,
  mapDisputedCard,
  mapLeaveCard,
  sortApprovalCardsDesc,
} from './cards';

export const APPROVALS_CAP = 200;

/**
 * The shipped `LEAVE_SELECT` / `ADVANCE_SELECT` / `DISPUTED_SELECT` constants
 * (reused verbatim from their respective row-VM builders) do NOT select
 * `employee.branchId` — the pure card mappers in `./cards` need it. Rather
 * than mutate those shared, already-shipped constants, this loader overrides
 * just the `employee` sub-select inline, keeping every other field intact.
 */
const leaveSelect = {
  ...LEAVE_SELECT,
  employee: {
    select: { ...LEAVE_SELECT.employee.select, branchId: true },
  },
} satisfies Prisma.LeaveRequestSelect;

const advanceSelect = {
  ...ADVANCE_SELECT,
  employee: {
    select: { ...ADVANCE_SELECT.employee.select, branchId: true },
  },
} satisfies Prisma.CashAdvanceSelect;

const disputedSelect = {
  ...DISPUTED_SELECT,
  employee: {
    select: { ...DISPUTED_SELECT.employee.select, branchId: true },
  },
} satisfies Prisma.AttendanceSelect;

export async function loadApprovalsInbox(
  assignments: ReadonlyArray<AssignmentForCheck>,
  filters: ApprovalFilters,
): Promise<{
  cards: ApprovalCard[];
  counts: { leave: number; advance: number; disputed: number; total: number };
  capped: boolean;
}> {
  const leaveScope = viaEmployeeBranchScope(
    permittedBranchesFromAssignments(assignments, 'leave.read'),
  );
  const advScope = viaEmployeeBranchScope(
    permittedBranchesFromAssignments(assignments, 'advance.read'),
  );
  const attScope = viaEmployeeBranchScope(
    permittedBranchesFromAssignments(assignments, 'attendance.read'),
  );

  const take = APPROVALS_CAP + 1;
  const [leaveRows, advanceRows, disputedRows] = await Promise.all([
    prisma.leaveRequest.findMany({
      where: { status: 'Pending', ...leaveScope },
      orderBy: { createdAt: 'desc' },
      take,
      select: leaveSelect,
    }),
    prisma.cashAdvance.findMany({
      where: { status: 'Pending', ...advScope },
      orderBy: { requestedAt: 'desc' },
      take,
      select: advanceSelect,
    }),
    prisma.attendance.findMany({
      where: { type: 'CheckIn', checkInStatus: 'Disputed', ...attScope },
      orderBy: { clockInAt: 'desc' },
      take,
      select: disputedSelect,
    }),
  ]);

  const capped =
    leaveRows.length > APPROVALS_CAP ||
    advanceRows.length > APPROVALS_CAP ||
    disputedRows.length > APPROVALS_CAP;

  const leave = leaveRows.slice(0, APPROVALS_CAP);
  const advance = advanceRows.slice(0, APPROVALS_CAP);
  const disputed = disputedRows.slice(0, APPROVALS_CAP);

  const all: ApprovalCard[] = [
    ...leave.map((r) => mapLeaveCard(r)),
    ...advance.map((r) => mapAdvanceCard(r)),
    // One narrow cast remains:
    //  - `clockInAt` is nullable in the schema (Attendance.clockInAt
    //    DateTime?), but this query filters `type: 'CheckIn'`, and a CheckIn
    //    row always has clockInAt set at creation — non-null in practice.
    // `checkInBranch.latitude`/`.longitude` ARE nullable in practice (an
    // admin can clear a branch's geofence pin at any time via `updateBranch`,
    // leaving a non-null `checkInBranch` object with null coords). No cast
    // is needed for that: `DisputedCardInput['checkInBranch']` already
    // allows null coords, and `mapDisputedCard` guards on them before use.
    ...disputed.map((r) =>
      mapDisputedCard({
        ...r,
        clockInAt: r.clockInAt as Date,
      }),
    ),
  ];

  const cards = sortApprovalCardsDesc(filterApprovalCards(all, filters));

  return {
    cards,
    counts: {
      leave: leave.length,
      advance: advance.length,
      disputed: disputed.length,
      total: leave.length + advance.length + disputed.length,
    },
    capped,
  };
}
