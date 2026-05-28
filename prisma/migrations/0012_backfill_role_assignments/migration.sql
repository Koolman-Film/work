-- ─── 0012 — Backfill missing UserRoleAssignment rows ──────────────────────
--
-- Phase 4 prep: gather every active User who has NO active role
-- assignment and create one based on their legacy `User.role`.
--
-- Why this gap exists:
--   Migration 0009 (Phase 1) backfilled assignments for users that
--   existed AT THAT MOMENT, but createEmployee + createTeamMember
--   continued writing only the legacy `User.role` enum and skipped
--   `UserRoleAssignment.create()`. Result: users created after 0009
--   silently lack assignments. They still log in (requireRole reads
--   `User.role`) but every requirePermission gate denies them — see
--   Phase 3.6 onward.
--
--   Prod state at the time of writing: 3 out of 6 active Admin users
--   are missing assignments. Staff + Superadmin happened to be all
--   covered because they're either old (pre-0009) or new-Staff
--   created via paths that did write assignments.
--
-- Mapping rule:
--   legacy User.role='Superadmin' → assignment to system 'superadmin' role, branchId=NULL
--   legacy User.role='Admin'      → assignment to system 'admin' role, branchId=NULL
--   legacy User.role='Staff'      → assignment to system 'staff' role,
--                                   branchId = Employee.branchId (home branch)
--
-- Why home-branch for Staff: 0009 split Staff users across all branches
-- in their assignedBranchIds. For the gap-fill case (new Staff missing
-- ANY assignment) we conservatively assign only home branch — assignedBranchIds
-- can be added later via the team UI if needed. The home branch is
-- the most-correct minimum.
--
-- Idempotent: WHERE NOT EXISTS guard ensures users with any active
-- assignment are skipped. Re-running yields no changes.
--
-- Limitation: archived users are intentionally NOT backfilled. They
-- can't log in (requireRole rejects archivedAt != NULL), so the
-- missing assignment is moot. Skipping them keeps the assignment
-- count clean.

INSERT INTO "UserRoleAssignment" ("id", "userId", "roleId", "branchId", "createdAt")
SELECT
  gen_random_uuid(),
  u."id",
  rd."id",
  CASE WHEN u."role" = 'Staff' THEN e."branchId" ELSE NULL END,
  NOW()
FROM "User" u
LEFT JOIN "Employee" e ON e."userId" = u."id" AND e."archivedAt" IS NULL
JOIN "RoleDefinition" rd
  ON rd."key" = LOWER(u."role"::TEXT)
 AND rd."isSystem" = TRUE
 AND rd."archivedAt" IS NULL
WHERE u."archivedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "UserRoleAssignment" a
    JOIN "RoleDefinition" rd2 ON rd2."id" = a."roleId"
    WHERE a."userId" = u."id"
      AND rd2."archivedAt" IS NULL
  );
