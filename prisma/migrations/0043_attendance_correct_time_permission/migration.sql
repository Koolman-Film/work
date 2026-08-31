-- Grant the new clock-time-correction permission to the system Admin role.
--
-- roles.ts (SYSTEM_ROLES) only affects fresh seeds; established DBs — including
-- prod — need this backfill or the correction control 404s for every admin,
-- because requirePermission reads RoleDefinition.permissions from the DB, not
-- from code. Idempotent. Superadmin grants everything via isSuperadmin, so no
-- change needed there. Mirrors 0030 / 0038 / 0040.
--
-- A NEW permission rather than reusing attendance.manual-create: that one
-- authorises CREATING a hand-keyed entry, whereas this EDITS an existing
-- record — including LIFF check-ins the employee submitted themselves with a
-- selfie and GPS attached. Those are different powers and should not share a
-- grant.
--
-- ROLLBACK NOTE: this migration adds a permission, so it carries the
-- permission-strip trap in docs/runbooks/deploy-rollback.md — after a rollback,
-- the next save on the role-settings page drops it, and re-deploying does not
-- restore it because the migration is already marked applied.

UPDATE "RoleDefinition"
SET "permissions" = array_append("permissions", 'attendance.correct-time')
WHERE "key" = 'admin'
  AND NOT ('attendance.correct-time' = ANY("permissions"));
