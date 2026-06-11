-- ─── 0028 — Grant payroll.* to the existing Admin role ────────────────────
--
-- Payroll management shipped (0027 + admin pages). The payroll.read /
-- payroll.run / payroll.publish keys have existed in the catalog since
-- Phase 2, but were never in the Admin role's permissions array — neither
-- in code defaults nor in seeded rows. The code defaults (roles.ts) were
-- updated in the same change; this backfills the LIVE RoleDefinition row,
-- otherwise existing admins 404 on /admin/payroll.
--
-- Scope: admin ONLY.
--   - staff: not granted — workers see their own slip via /liff/payslip.
--   - superadmin: not updated — isSuperadmin=true short-circuits canDo().
--
-- Idempotent per-key: the NOT (… @> …) guards make re-running a no-op.
-- Mirrors 0015 / 0026.

UPDATE "RoleDefinition"
SET permissions = permissions || ARRAY['payroll.read']
WHERE key = 'admin'
  AND NOT (permissions @> ARRAY['payroll.read']);

UPDATE "RoleDefinition"
SET permissions = permissions || ARRAY['payroll.run']
WHERE key = 'admin'
  AND NOT (permissions @> ARRAY['payroll.run']);

UPDATE "RoleDefinition"
SET permissions = permissions || ARRAY['payroll.publish']
WHERE key = 'admin'
  AND NOT (permissions @> ARRAY['payroll.publish']);
