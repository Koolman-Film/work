-- ─── 0038 — Grant filing.read / filing.export to the existing Admin role ──
--
-- Statutory filings (สปส.1-10 monthly SSO export). The new permission keys
-- (filing.read, filing.export) were added to the catalog and to the Admin
-- role's CODE defaults (src/lib/auth/roles.ts) in the same change. But
-- canDo() reads the LIVE RoleDefinition.permissions array, so the
-- already-seeded Admin role row needs them appended too — otherwise
-- existing admins 404 on the filings page / export route.
--
-- Scope: admin ONLY.
--   - staff: intentionally NOT granted — no filings UI for workers.
--   - superadmin: NOT updated — isSuperadmin=true short-circuits canDo().
--
-- Idempotent per-key: the NOT (… @> …) guards make re-running a no-op.
-- Mirrors 0026 / 0028 / 0029.

UPDATE "RoleDefinition"
SET permissions = permissions || ARRAY['filing.read']
WHERE key = 'admin'
  AND NOT (permissions @> ARRAY['filing.read']);

UPDATE "RoleDefinition"
SET permissions = permissions || ARRAY['filing.export']
WHERE key = 'admin'
  AND NOT (permissions @> ARRAY['filing.export']);
