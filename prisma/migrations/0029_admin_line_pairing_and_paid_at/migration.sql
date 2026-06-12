-- ─── 0029 — Admin LINE pairing columns, CashAdvance.paidAt, liff.admin backfill ──
--
-- Three changes in one migration:
--
-- 1. User.lineInviteToken + User.lineInviteExpiresAt
--    Allows admins (who have no Employee row) to pair their LINE account.
--    Mirrors Employee.inviteToken but lives on User. Token is nulled on
--    successful pair or regenerate.
--
-- 2. CashAdvance.paidAt
--    Two-step payment tracking: set the FIRST time a transfer slip is
--    attached after approval. receiptUrl + paidAt together mean "money sent".
--    Slip re-upload replaces receiptUrl but never overwrites paidAt.
--
-- 3. Permission backfill: grant liff.admin to the existing Admin role.
--    The liff.admin key was added to the catalog and to the Admin role's
--    CODE defaults (src/lib/auth/roles.ts) in the same change. But canDo()
--    reads the LIVE RoleDefinition.permissions array, so the already-seeded
--    Admin role row needs it appended too.
--
-- Scope: admin ONLY.
--   - staff: intentionally NOT granted (staff use liff.* worker keys).
--   - superadmin: NOT updated — isSuperadmin=true short-circuits canDo().
--
-- Idempotent: the NOT (… @> …) guard means re-running is a no-op. Mirrors 0026 / 0028.

ALTER TABLE "User" ADD COLUMN "lineInviteToken" TEXT;
ALTER TABLE "User" ADD COLUMN "lineInviteExpiresAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "User_lineInviteToken_key" ON "User"("lineInviteToken");

ALTER TABLE "CashAdvance" ADD COLUMN "paidAt" TIMESTAMP(3);

UPDATE "RoleDefinition"
SET permissions = permissions || ARRAY['liff.admin']
WHERE key = 'admin'
  AND NOT (permissions @> ARRAY['liff.admin']);
