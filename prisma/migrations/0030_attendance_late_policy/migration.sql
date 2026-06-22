-- Company late-arrival policy: admin-editable work start + grace, plus the
-- permission gating the new /admin/settings/attendance page.

ALTER TABLE "PayrollConfig" ADD COLUMN "workStartTime" TEXT NOT NULL DEFAULT '09:00';
ALTER TABLE "PayrollConfig" ADD COLUMN "lateGraceMinutes" INTEGER NOT NULL DEFAULT 15;

-- Backfill the new permission onto the existing system Admin role (roles.ts
-- only affects fresh seeds; established DBs need this). Idempotent. Superadmin
-- grants everything via isSuperadmin, so no change needed there.
UPDATE "RoleDefinition"
SET "permissions" = array_append("permissions", 'settings.attendance.manage')
WHERE "key" = 'admin'
  AND NOT ('settings.attendance.manage' = ANY("permissions"));
