-- ─── 0014 — Soft-delete columns for transactional records ─────────────────
--
-- Adds deletedAt/deletedById/deleteReason to Attendance, LeaveRequest,
-- CashAdvance. Replaces Attendance's plain unique with a PARTIAL unique
-- index so a voided row frees its (employeeId, date, type) slot, letting an
-- admin enter the correct row. See spec §4.1.

-- Attendance
ALTER TABLE "Attendance" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Attendance" ADD COLUMN "deletedById" UUID;
ALTER TABLE "Attendance" ADD COLUMN "deleteReason" TEXT;

DROP INDEX IF EXISTS "Attendance_employeeId_date_type_key";
CREATE UNIQUE INDEX "Attendance_employeeId_date_type_live_key"
  ON "Attendance" ("employeeId", "date", "type")
  WHERE "deletedAt" IS NULL;
CREATE INDEX "Attendance_deletedAt_idx" ON "Attendance" ("deletedAt");

-- LeaveRequest
ALTER TABLE "LeaveRequest" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "LeaveRequest" ADD COLUMN "deletedById" UUID;
ALTER TABLE "LeaveRequest" ADD COLUMN "deleteReason" TEXT;
CREATE INDEX "LeaveRequest_deletedAt_idx" ON "LeaveRequest" ("deletedAt");

-- CashAdvance
ALTER TABLE "CashAdvance" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "CashAdvance" ADD COLUMN "deletedById" UUID;
ALTER TABLE "CashAdvance" ADD COLUMN "deleteReason" TEXT;
CREATE INDEX "CashAdvance_deletedAt_idx" ON "CashAdvance" ("deletedAt");
