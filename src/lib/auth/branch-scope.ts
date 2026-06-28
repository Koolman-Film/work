// src/lib/auth/branch-scope.ts
import type { Prisma, User } from '@prisma/client';
import { type AssignmentForCheck, getUserAssignments } from './check-permission';
import type { Permission } from './permissions';

/** 'all' = holds the permission via a global (branchId=null) assignment.
 *  Otherwise the de-duped scoped branchIds granting it; [] = nowhere. */
export type PermittedBranches = 'all' | string[];

/** Pure: which branches may these assignments exercise `permission` in? */
export function permittedBranchesFromAssignments(
  assignments: ReadonlyArray<AssignmentForCheck>,
  permission: Permission,
): PermittedBranches {
  const branchIds = new Set<string>();
  for (const a of assignments) {
    if (a.role.archivedAt) continue;
    const grants = a.role.isSuperadmin || a.role.permissions.includes(permission);
    if (!grants) continue;
    if (a.branchId === null) return 'all'; // global grant trumps everything
    branchIds.add(a.branchId);
  }
  return [...branchIds];
}

/** IO wrapper — one assignment load, then the pure resolution. */
export async function getPermittedBranches(
  user: Pick<User, 'id'>,
  permission: Permission,
): Promise<PermittedBranches> {
  const assignments = await getUserAssignments(user.id);
  return permittedBranchesFromAssignments(assignments, permission);
}

/** Employee where-fragment for the permitted branches. {} = no filter (global).
 *  Matches home branch OR assignedBranchIds (multi-branch staff). [] = nothing. */
export function employeeBranchScope(permitted: PermittedBranches): Prisma.EmployeeWhereInput {
  if (permitted === 'all') return {};
  if (permitted.length === 0) return { id: { in: [] } };
  return {
    OR: [{ branchId: { in: permitted } }, { assignedBranchIds: { hasSome: permitted } }],
  };
}

/** For via-Employee models (Attendance/Leave/Advance/...). {} when 'all'. */
export function viaEmployeeBranchScope(permitted: PermittedBranches): {
  employee?: Prisma.EmployeeWhereInput;
} {
  if (permitted === 'all') return {};
  return { employee: employeeBranchScope(permitted) };
}
