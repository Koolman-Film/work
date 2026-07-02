/**
 * Team-management authorization helpers.
 *
 * These layer on TOP of the permission catalog (`requirePermission`):
 * once we know the actor holds, e.g., `team.update` somewhere, we need
 * to also know "do they have JURISDICTION over this specific target?"
 * That's a different question than `canDo(user, perm, branchId)`, which
 * answers "do you have this permission at this branch?"
 *
 * Phase 3.5 originally tightened team management to Superadmin-only.
 * Phase 3.7 relaxed it to "Admin manages Admin in the same branch."
 * These guards encode the relaxed rule.
 *
 * Two complementary checks:
 *   - `canActOnRole(actorRole, targetRole)` — TIER guard. Admin cannot
 *     touch Superadmin no matter what branch they share.
 *   - `canActOnUserScope(actor, target)` — BRANCH guard. A branch-A
 *     Admin cannot touch a branch-B Admin even though both are Admins.
 *
 * Callers should run BOTH (typically) plus the permission gate.
 */

import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { PAYROLL_PERMISSIONS } from './permissions';

/**
 * Tier guard — does the actor's tier allow acting on the target's tier
 * at all? Takes computed tier values (see computeTier in user-tier.ts).
 *
 *   - Superadmin can touch anyone (incl. other Superadmins, per the
 *     Phase 3.7 product decision).
 *   - Admin can touch Admin only (never Superadmin, never Staff).
 *   - Staff can never use team management.
 *
 * Pure / synchronous because the caller already has both tiers in hand.
 */
export function canActOnRole(actorRole: Role | null, targetRole: Role): boolean {
  if (actorRole === 'Superadmin') return true;
  if (actorRole === 'Admin') return targetRole === 'Admin';
  return false; // null or 'Staff': no team jurisdiction
}

/**
 * Pure variant of `canActOnUserScope` for unit testing. Takes
 * already-fetched assignment lists; no DB I/O.
 *
 * Rules (in evaluation order on the actor side):
 *   1. Actor has any active Superadmin assignment → ALLOW.
 *      (Superadmin transcends scope, mirroring canDo().)
 *   2. Actor has any active GLOBAL assignment (branchId=NULL) → ALLOW.
 *      (Global Admin manages anyone, anywhere.)
 *   3. Actor is branch-scoped only. Walk the target's assignments:
 *        - Target has any GLOBAL assignment → DENY. A branch-only
 *          actor lacks authority over an "everywhere" target;
 *          allowing would be lateral privilege escalation.
 *        - Otherwise ALLOW iff actor and target share at least one
 *          branchId in their active assignments.
 *
 * Same-user is always allowed (self-edits are gated by per-action
 * "isSelf" guards, not by this scope check).
 *
 * Empty target assignments (e.g., a brand-new user before the
 * Superadmin has added the first assignment): the function returns
 * `false` for a branch-scoped actor. The new-user "claim" flow uses
 * `addRoleAssignment` which has its own branch-scoped permission
 * check (not this guard), so this asymmetry is intentional.
 */
export type ScopeAssignment = {
  branchId: string | null;
  role: { archivedAt: Date | null; isSuperadmin: boolean };
};

export function checkUserScope(
  actorAssignments: ReadonlyArray<ScopeAssignment>,
  targetAssignments: ReadonlyArray<ScopeAssignment>,
  isSameUser: boolean,
): boolean {
  if (isSameUser) return true;

  const actorBranches = new Set<string>();
  for (const a of actorAssignments) {
    if (a.role.archivedAt) continue;
    if (a.role.isSuperadmin) return true; // Rule 1
    if (a.branchId === null) return true; // Rule 2
    actorBranches.add(a.branchId);
  }

  // Rule 3: actor is branch-scoped only.
  for (const a of targetAssignments) {
    if (a.role.archivedAt) continue;
    if (a.branchId === null) {
      // Target operates "everywhere" — branch-only actor can't claim
      // jurisdiction.
      return false;
    }
    if (actorBranches.has(a.branchId)) return true;
  }
  return false;
}

/**
 * Tier-conferring (system) roles — admin/staff/superadmin — may only be
 * granted or removed by an actor who actually holds an admin tier. A
 * permission-only actor (tier null) or Staff with role.assign must not be
 * able to mint or strip system roles: that would be privilege escalation
 * now that permission-based admission lets tier-less users reach the
 * role-assignment actions. Custom roles (isSystem=false) are governed by
 * the existing canDo / branch-scope guards, not this one.
 */
export function canManageSystemRole(actorRole: Role | null, role: { isSystem: boolean }): boolean {
  if (!role.isSystem) return true;
  return actorRole === 'Admin' || actorRole === 'Superadmin';
}

/**
 * Static (non-branch) grant guard shared by createTeamMember and
 * addRoleAssignment: a Superadmin role may only be granted by a Superadmin,
 * and any system (tier-conferring) role requires the actor to hold an admin
 * tier. Returns a Thai error string to surface, or null if allowed on these
 * grounds. Branch/global authority is checked separately by the caller.
 */
export function systemRoleGrantError(
  actorRole: Role | null,
  role: { isSuperadmin: boolean; isSystem: boolean },
): string | null {
  if (role.isSuperadmin && actorRole !== 'Superadmin') {
    return 'ต้องเป็น Superadmin เพื่อมอบบทบาท Superadmin';
  }
  if (!canManageSystemRole(actorRole, role)) {
    return 'ต้องมีสิทธิ์ระดับผู้ดูแลเพื่อมอบบทบาทระบบ';
  }
  return null;
}

/**
 * A payroll-bearing CUSTOM role may only be assigned GLOBALLY. Returns a Thai
 * error string when a branch-scoped assignment (branchId != null) targets a
 * role whose permissions include any PAYROLL_PERMISSIONS; null when allowed.
 * Payroll is an org-wide surface (see B-payroll-guard) — a branch-scoped
 * payroll grant is both inert (requireGlobalPermission blocks it) and
 * forbidden here so the confusing state never exists.
 */
export function payrollRoleBranchScopeError(
  role: { permissions: ReadonlyArray<string>; isSystem: boolean },
  branchId: string | null,
): string | null {
  // Global assignment, or a platform-managed SYSTEM role (admin/superadmin/staff):
  // exempt. System roles' branch-scoping is a supported config (branch admin);
  // Layer 1 (requireGlobalPermission) still denies them payroll access. Layer 2
  // targets CUSTOM roles that bundle payroll perms into a branch grant.
  if (branchId === null || role.isSystem) return null;
  const hasPayroll = role.permissions.some((p) =>
    (PAYROLL_PERMISSIONS as ReadonlyArray<string>).includes(p),
  );
  return hasPayroll ? 'บทบาทที่มีสิทธิ์เงินเดือนต้องกำหนดแบบทั้งองค์กร (ไม่ระบุสาขา)' : null;
}

/**
 * Async I/O wrapper around `checkUserScope`. Fetches the two assignment
 * sets in parallel.
 */
export async function canActOnUserScope(
  actorUserId: string,
  targetUserId: string,
): Promise<boolean> {
  if (actorUserId === targetUserId) return true;

  const [actorAssignments, targetAssignments] = await Promise.all([
    prisma.userRoleAssignment.findMany({
      where: { userId: actorUserId },
      select: {
        branchId: true,
        role: { select: { archivedAt: true, isSuperadmin: true } },
      },
    }),
    prisma.userRoleAssignment.findMany({
      where: { userId: targetUserId },
      select: {
        branchId: true,
        role: { select: { archivedAt: true, isSuperadmin: true } },
      },
    }),
  ]);

  return checkUserScope(actorAssignments, targetAssignments, false);
}
