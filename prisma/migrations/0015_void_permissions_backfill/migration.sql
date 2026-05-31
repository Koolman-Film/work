-- ─── 0015 — Grant void permissions to the existing Admin role ─────────────
--
-- Phase: soft-delete/void feature. The three new permission keys
-- (attendance.void, leave.void, advance.void) were added to the catalog and
-- to the Admin role's CODE defaults (src/lib/auth/roles.ts) in the same
-- change. But canDo() reads the LIVE RoleDefinition.permissions array, so the
-- already-seeded Admin role row needs them appended too — otherwise existing
-- admins can't void until someone re-seeds.
--
-- Scope: admin ONLY.
--   - staff: intentionally NOT granted (Staff must not void).
--   - superadmin: NOT updated — its permissions array is empty by design and
--     isSuperadmin=true short-circuits canDo() to grant every permission. Adding
--     keys to its array would be redundant and drift from the code's intent.
--
-- Idempotent: the `NOT (… @> …)` guard means re-running is a no-op. Mirrors 0010.

UPDATE "RoleDefinition"
SET permissions = permissions || ARRAY['attendance.void', 'leave.void', 'advance.void']
WHERE key = 'admin'
  AND NOT (permissions @> ARRAY['attendance.void']);
