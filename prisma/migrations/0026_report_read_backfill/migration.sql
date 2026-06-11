-- ─── 0026 — Grant report.read to the existing Admin role ──────────────────
--
-- Phase: reports + entitlement enforcement. The new permission key
-- (report.read) was added to the catalog and to the Admin role's CODE
-- defaults (src/lib/auth/roles.ts) in the same change. But canDo() reads the
-- LIVE RoleDefinition.permissions array, so the already-seeded Admin role row
-- needs it appended too — otherwise existing admins get a 404 on
-- /admin/reports until someone re-seeds.
--
-- Scope: admin ONLY.
--   - staff: intentionally NOT granted (workers use /liff/summary instead).
--   - superadmin: NOT updated — isSuperadmin=true short-circuits canDo().
--
-- Idempotent: the `NOT (… @> …)` guard means re-running is a no-op. Mirrors 0015.

UPDATE "RoleDefinition"
SET permissions = permissions || ARRAY['report.read']
WHERE key = 'admin'
  AND NOT (permissions @> ARRAY['report.read']);
