-- ─── 0018 — Overtime ──────────────────────────────────────────────────────
-- OvertimeEntry (one per employee/date, partial-unique excludes voided rows),
-- per-employee default OT rates, and OT-config knobs on PayrollConfig. See
-- spec §Phase 3. Record-only: no payroll-run wiring.

CREATE TYPE "OtRateType" AS ENUM ('PerHourAmount', 'Multiplier');
CREATE TYPE "OtStatus" AS ENUM ('Approved', 'Rejected');

ALTER TABLE "Employee" ADD COLUMN "defaultOtRateType" "OtRateType";
ALTER TABLE "Employee" ADD COLUMN "defaultOtRatePerHour" DECIMAL(12,2);
ALTER TABLE "Employee" ADD COLUMN "defaultOtMultiplier" DECIMAL(3,2);

ALTER TABLE "PayrollConfig" ADD COLUMN "workingDaysPerMonth" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "PayrollConfig" ADD COLUMN "otThresholdMinutes" INTEGER NOT NULL DEFAULT 30;

CREATE TABLE "OvertimeEntry" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "minutes" INTEGER NOT NULL,
    "rateType" "OtRateType" NOT NULL,
    "ratePerHour" DECIMAL(12,2),
    "multiplier" DECIMAL(3,2),
    "computedAmount" DECIMAL(12,2) NOT NULL,
    "status" "OtStatus" NOT NULL,
    "sourceAttendanceId" UUID,
    "note" TEXT,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "deletedById" UUID,
    "deleteReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID NOT NULL,
    CONSTRAINT "OvertimeEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OvertimeEntry_employeeId_date_idx" ON "OvertimeEntry" ("employeeId", "date");
CREATE INDEX "OvertimeEntry_status_idx" ON "OvertimeEntry" ("status");
CREATE INDEX "OvertimeEntry_deletedAt_idx" ON "OvertimeEntry" ("deletedAt");

-- One live OT entry per (employee, date); a voided row frees the slot.
CREATE UNIQUE INDEX "OvertimeEntry_employeeId_date_live_key"
  ON "OvertimeEntry" ("employeeId", "date")
  WHERE "deletedAt" IS NULL;

ALTER TABLE "OvertimeEntry"
  ADD CONSTRAINT "OvertimeEntry_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OvertimeEntry"
  ADD CONSTRAINT "OvertimeEntry_sourceAttendanceId_fkey"
  FOREIGN KEY ("sourceAttendanceId") REFERENCES "Attendance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
