-- Attendance penalties may be settled with leave entitlement instead of money.

CREATE TYPE "PenaltyKind" AS ENUM ('Absent', 'LateThreeStrike', 'SevereLate');

CREATE TABLE "AttendancePenaltySettlement" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employeeId" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "kind" "PenaltyKind" NOT NULL,
    "leaveTypeId" UUID NOT NULL,
    "days" DECIMAL(5,2) NOT NULL,
    "minutes" INTEGER NOT NULL,
    "periodYear" INTEGER NOT NULL,
    "note" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "AttendancePenaltySettlement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AttendancePenaltySettlement_employeeId_month_kind_key"
    ON "AttendancePenaltySettlement" ("employeeId", "month", "kind");
CREATE INDEX "AttendancePenaltySettlement_employeeId_periodYear_leaveTypeId_idx"
    ON "AttendancePenaltySettlement" ("employeeId", "periodYear", "leaveTypeId");
CREATE INDEX "AttendancePenaltySettlement_month_idx"
    ON "AttendancePenaltySettlement" ("month");
CREATE INDEX "AttendancePenaltySettlement_deletedAt_idx"
    ON "AttendancePenaltySettlement" ("deletedAt");

ALTER TABLE "AttendancePenaltySettlement"
    ADD CONSTRAINT "AttendancePenaltySettlement_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "Employee"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AttendancePenaltySettlement"
    ADD CONSTRAINT "AttendancePenaltySettlement_leaveTypeId_fkey"
    FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Which leave types may be spent on a penalty. Default false; only the two
-- discretionary types are opted in. Sick and maternity leave must never be
-- consumable as a punishment.
ALTER TABLE "LeaveType"
    ADD COLUMN "penaltySettlementAllowed" BOOLEAN NOT NULL DEFAULT false;

UPDATE "LeaveType" SET "penaltySettlementAllowed" = true
    WHERE "name" IN ('ลากิจ', 'ลาพักร้อน');
