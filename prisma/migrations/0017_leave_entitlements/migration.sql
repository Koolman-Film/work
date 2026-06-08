-- ─── 0017 — Per-employee leave entitlements ───────────────────────────────
-- One row per (employee, leave type, year). grantedMinutes NULL = unlimited.
-- See spec §Phase 2.

CREATE TABLE "LeaveEntitlement" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "leaveTypeId" UUID NOT NULL,
    "periodYear" INTEGER NOT NULL,
    "grantedMinutes" INTEGER,
    "carryoverMinutes" INTEGER NOT NULL DEFAULT 0,
    "adjustmentMinutes" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LeaveEntitlement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeaveEntitlement_employeeId_leaveTypeId_periodYear_key"
  ON "LeaveEntitlement" ("employeeId", "leaveTypeId", "periodYear");
CREATE INDEX "LeaveEntitlement_employeeId_periodYear_idx"
  ON "LeaveEntitlement" ("employeeId", "periodYear");

ALTER TABLE "LeaveEntitlement"
  ADD CONSTRAINT "LeaveEntitlement_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeaveEntitlement"
  ADD CONSTRAINT "LeaveEntitlement_leaveTypeId_fkey"
  FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
