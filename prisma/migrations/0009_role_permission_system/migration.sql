-- Phase 1 of the granular role/permission system.
--
-- Three things happen in this migration, in order:
--
--   1. Rename the legacy Role enum values:
--        Employee → Staff
--        Owner → Superadmin
--      (Admin stays.) Postgres supports ALTER TYPE ... RENAME VALUE in
--      version 10+; Supabase is on 15. Renaming is atomic — existing
--      rows that hold these enum values are unaffected.
--
--   2. Create the new tables: RoleDefinition + UserRoleAssignment.
--      RoleDefinition stores permission bundles; UserRoleAssignment links
--      a user to a role with an optional branch scope.
--
--   3. Seed the three system roles (Superadmin, Admin, Staff) and
--      MIGRATE every existing User into the new assignment table:
--        - role='Superadmin' (formerly Owner) → 1 Superadmin assignment, branch=NULL
--        - role='Admin' → 1 Admin assignment, branch=NULL
--        - role='Staff' (formerly Employee) → 1 Staff assignment per
--          branch in (Employee.branchId ∪ Employee.assignedBranchIds)
--
-- The legacy User.role column stays — existing requireRole() calls
-- across the codebase still depend on it. Phase 3 will retire it.

-- ─── 1. Rename enum values ─────────────────────────────────────────────

ALTER TYPE "Role" RENAME VALUE 'Employee' TO 'Staff';
ALTER TYPE "Role" RENAME VALUE 'Owner' TO 'Superadmin';

-- ─── 2. New tables ─────────────────────────────────────────────────────

CREATE TABLE "RoleDefinition" (
  "id"           UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "key"          TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "description"  TEXT,
  "permissions"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "isSuperadmin" BOOLEAN NOT NULL DEFAULT FALSE,
  "isSystem"     BOOLEAN NOT NULL DEFAULT FALSE,
  "archivedAt"   TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "RoleDefinition_key_key" ON "RoleDefinition"("key");
CREATE INDEX "RoleDefinition_archivedAt_idx" ON "RoleDefinition"("archivedAt");

CREATE TABLE "UserRoleAssignment" (
  "id"        UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "userId"    UUID NOT NULL,
  "roleId"    UUID NOT NULL,
  "branchId"  UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UserRoleAssignment_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UserRoleAssignment_roleId_fkey"
    FOREIGN KEY ("roleId") REFERENCES "RoleDefinition"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "UserRoleAssignment_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- The (userId, roleId, branchId) uniqueness lives at the DB layer.
-- Postgres treats NULL as distinct in unique indexes by default, so two
-- assignments with branchId=NULL for the same (userId, roleId) would be
-- considered different by the default index. To get the "NULL-aware"
-- uniqueness we want, use NULLS NOT DISTINCT (Postgres 15+, which
-- Supabase runs).
CREATE UNIQUE INDEX "UserRoleAssignment_userId_roleId_branchId_key"
  ON "UserRoleAssignment"("userId", "roleId", "branchId")
  NULLS NOT DISTINCT;
CREATE INDEX "UserRoleAssignment_userId_idx" ON "UserRoleAssignment"("userId");
CREATE INDEX "UserRoleAssignment_roleId_idx" ON "UserRoleAssignment"("roleId");
CREATE INDEX "UserRoleAssignment_branchId_idx" ON "UserRoleAssignment"("branchId");

-- ─── 3. Seed system roles ──────────────────────────────────────────────
-- Keep the permission arrays here in sync with src/lib/auth/roles.ts.
-- The seed.ts script is also idempotent — it upserts these same rows
-- (by `key`) on every fresh-DB seed run.
--
-- Superadmin has no permissions listed because `isSuperadmin=true`
-- short-circuits canDo() to grant everything regardless of the array.
-- Future permission additions don't need to touch this row.

INSERT INTO "RoleDefinition" ("key", "name", "description", "permissions", "isSuperadmin", "isSystem")
VALUES
  (
    'superadmin',
    'Superadmin',
    'ผู้ดูแลระบบสูงสุด — เข้าถึงทุกฟังก์ชัน ในทุกสาขา (รวมการสร้าง/แก้ไขบทบาท การจัดการบัญชีผู้ดูแลคนอื่น และเงินเดือน)',
    ARRAY[]::TEXT[],
    TRUE,
    TRUE
  ),
  (
    'admin',
    'Admin',
    'ผู้ดูแลสาขา — จัดการพนักงาน คำขอลา/เบิก และการลงเวลาในสาขาที่ได้รับมอบหมาย',
    ARRAY[
      'employee.read', 'employee.create', 'employee.update', 'employee.archive',
      'employee.line-unlink',
      'attendance.read', 'attendance.live-board', 'attendance.manual-create',
      'attendance.dispute-resolve',
      'leave.read', 'leave.approve',
      'advance.read', 'advance.approve',
      'settings.branch.manage', 'settings.department.manage',
      'settings.holiday.manage', 'settings.work-schedule.manage',
      'team.read', 'role.read',
      'audit.read', 'dashboard.read'
    ]::TEXT[],
    FALSE,
    TRUE
  ),
  (
    'staff',
    'Staff',
    'พนักงาน — เช็คอิน/เช็คเอาท์ ยื่นคำขอลา/เบิก และดู/แก้โปรไฟล์ตนเองผ่าน LIFF',
    ARRAY[
      'liff.check-in', 'liff.leave-submit', 'liff.advance-submit',
      'liff.profile-edit'
    ]::TEXT[],
    FALSE,
    TRUE
  );

-- ─── 4. Backfill UserRoleAssignment from legacy User.role ──────────────

-- Superadmin: one assignment per Owner-turned-Superadmin user, branch=NULL.
INSERT INTO "UserRoleAssignment" ("userId", "roleId", "branchId")
SELECT
  u.id,
  (SELECT id FROM "RoleDefinition" WHERE key = 'superadmin'),
  NULL
FROM "User" u
WHERE u.role = 'Superadmin';

-- Admin: existing Admin users were global (no branch scope), so one
-- assignment per user with branch=NULL. Phase 3 may later let admins
-- be per-branch via the UI; for now we preserve the existing global
-- semantics so nothing breaks.
INSERT INTO "UserRoleAssignment" ("userId", "roleId", "branchId")
SELECT
  u.id,
  (SELECT id FROM "RoleDefinition" WHERE key = 'admin'),
  NULL
FROM "User" u
WHERE u.role = 'Admin';

-- Staff: one assignment per (User, branch) pair. Branches = home
-- branch ∪ assignedBranchIds.
--
-- Two separate INSERTs is simpler than wrestling with PG's type
-- inference on UUID[] vs TEXT[] when concatenating arrays —
-- Employee.branchId is UUID while assignedBranchIds is TEXT[] (Prisma
-- doesn't propagate the element-level @db.Uuid annotation into the
-- array type). ON CONFLICT handles the dedupe when a home branch
-- appears in assignedBranchIds too.

-- (a) Home branch — one row per Employee.
INSERT INTO "UserRoleAssignment" ("userId", "roleId", "branchId")
SELECT
  u.id,
  (SELECT id FROM "RoleDefinition" WHERE key = 'staff'),
  e."branchId"
FROM "User" u
JOIN "Employee" e ON e."userId" = u.id
WHERE u.role = 'Staff'
ON CONFLICT ("userId", "roleId", "branchId") DO NOTHING;

-- (b) Each entry in assignedBranchIds — TEXT cast to UUID at insert time.
INSERT INTO "UserRoleAssignment" ("userId", "roleId", "branchId")
SELECT
  u.id,
  (SELECT id FROM "RoleDefinition" WHERE key = 'staff'),
  branch_id::UUID
FROM "User" u
JOIN "Employee" e ON e."userId" = u.id
JOIN LATERAL unnest(COALESCE(e."assignedBranchIds", ARRAY[]::TEXT[])) AS branch_id ON TRUE
WHERE u.role = 'Staff'
ON CONFLICT ("userId", "roleId", "branchId") DO NOTHING;
