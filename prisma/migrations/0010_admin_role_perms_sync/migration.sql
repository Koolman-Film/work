-- ─── 0010 — Sync Admin role permissions with code defaults ────────────────
--
-- Phase 3 (gradual requireRole → requirePermission migration) surfaced
-- that the Admin role's permissions array in the DB had drifted from
-- what the legacy requireRole(['Admin']) gates implicitly granted:
--
--   - 'settings.accounting-group.manage' — actions migrated in 3.3
--   - 'settings.leave-type.manage'       — actions migrated in 3.3
--   - 'employee.delete'                  — actions migrated in 3.6
--
-- These were always operationally available to Admins through the
-- legacy gates; the new fine-grained model requires them to be
-- explicitly listed.
--
-- Why this matters NOW (and didn't break anything yet):
--   - Production has only Superadmin admins today. They bypass the
--     permission array via the isSuperadmin shortcut, so the drift
--     was invisible.
--   - Tomorrow's customers will create plain Admin users (using the
--     team/role UI we shipped in Phase 2). Without this migration,
--     those Admins would silently lose access to accounting groups,
--     leave types, and employee hard-delete — which the customer
--     would experience as a regression.
--
-- The update is idempotent: array_append with a "not yet present" guard
-- via array operators. Running it twice yields the same final state.
--
-- This migration only touches the system 'admin' role (isSystem=true,
-- key='admin'). Custom roles created by the customer through the Roles
-- CRUD are untouched.

UPDATE "RoleDefinition"
SET "permissions" = ARRAY(
  SELECT DISTINCT unnest(
    "permissions" || ARRAY[
      'settings.accounting-group.manage',
      'settings.leave-type.manage',
      'employee.delete'
    ]::TEXT[]
  )
)
WHERE "key" = 'admin' AND "isSystem" = TRUE;
