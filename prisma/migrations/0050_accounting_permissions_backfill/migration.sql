-- ─── 0050 — Grant accounting.* to the existing Admin role ─────────────────
--
-- The payroll journal export. The new keys were added to the catalog and to
-- the Admin role's CODE defaults (src/lib/auth/roles.ts) in the same change,
-- but canDo() reads the LIVE RoleDefinition.permissions array, so the
-- already-seeded Admin row needs them appended too — otherwise existing
-- admins 404 on the accounting page and the export route.
--
-- Scope: admin ONLY.
--   - staff: intentionally NOT granted — the company's books are not a
--     worker-facing surface.
--   - superadmin: NOT updated — isSuperadmin=true short-circuits canDo().
--
-- Idempotent per-key: the NOT (… @> …) guards make re-running a no-op.
-- Mirrors 0026 / 0028 / 0029 / 0038.

UPDATE "RoleDefinition"
SET permissions = permissions || ARRAY['accounting.read']
WHERE key = 'admin'
  AND NOT (permissions @> ARRAY['accounting.read']);

UPDATE "RoleDefinition"
SET permissions = permissions || ARRAY['accounting.export']
WHERE key = 'admin'
  AND NOT (permissions @> ARRAY['accounting.export']);

UPDATE "RoleDefinition"
SET permissions = permissions || ARRAY['accounting.map']
WHERE key = 'admin'
  AND NOT (permissions @> ARRAY['accounting.map']);
