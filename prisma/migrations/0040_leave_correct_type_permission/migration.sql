-- Grant the new leave-type-correction permission to the system Admin role.
--
-- roles.ts (SYSTEM_ROLES) only affects fresh seeds; established DBs — including
-- prod — need this backfill or the /admin/leave correction control 404s for
-- every admin, because requirePermission reads RoleDefinition.permissions from
-- the DB, not from code. Idempotent. Superadmin grants everything via
-- isSuperadmin, so no change needed there. Mirrors 0030 / 0038.

UPDATE "RoleDefinition"
SET "permissions" = array_append("permissions", 'leave.correct-type')
WHERE "key" = 'admin'
  AND NOT ('leave.correct-type' = ANY("permissions"));
