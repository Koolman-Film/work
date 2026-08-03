-- Admin waiver of an over-quota leave deduction.
--
-- `overQuotaMinutes` stays FACTUAL — the employee really was that far beyond
-- quota, and rewriting it would erase that from the record. The waiver is a
-- separate, visible decision layered on top: "we chose not to charge N of
-- those minutes, because <reason>".
--
-- Minutes, not baht. The deduction is derived on read as minutes × the
-- employee's current per-minute rate, so a waiver stored in baht would drift
-- the moment a salary changed. Minutes stay correct through a raise.
--
-- Additive and nullable/defaulted, so a rollback is safe: code that predates
-- this ignores the columns and computes exactly what it did before.
ALTER TABLE "LeaveRequest"
  ADD COLUMN "waivedOverQuotaMinutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "waiveReason"            TEXT,
  ADD COLUMN "waivedAt"               TIMESTAMP(3),
  ADD COLUMN "waivedById"             UUID;

-- Partial index: waivers are rare, and the queries that care ("show me every
-- deduction someone forgave") only ever want the non-zero rows.
CREATE INDEX "LeaveRequest_waivedOverQuotaMinutes_idx"
  ON "LeaveRequest" ("waivedOverQuotaMinutes")
  WHERE "waivedOverQuotaMinutes" > 0;

-- Grant the waiver permission to the system Admin role.
--
-- roles.ts (SYSTEM_ROLES) only affects fresh seeds; established DBs — including
-- prod — need this backfill or the waive control is invisible to every admin,
-- because requirePermission reads RoleDefinition.permissions from the DB, not
-- from code. Idempotent. Superadmin grants everything via isSuperadmin.
-- Mirrors 0030 / 0038 / 0040.
--
-- NOTE for a rollback: this row survives a code rollback, and saving any role
-- in ตั้งค่า → บทบาท while rolled back STRIPS it (role-form.tsx renders
-- checkboxes from the code's PERMISSION_GROUPS). Re-deploying will not restore
-- it, because prisma migrate deploy skips an already-applied migration — see
-- docs/runbooks/deploy-rollback.md.
UPDATE "RoleDefinition"
SET "permissions" = array_append("permissions", 'leave.waive-deduction')
WHERE "key" = 'admin'
  AND NOT ('leave.waive-deduction' = ANY("permissions"));
