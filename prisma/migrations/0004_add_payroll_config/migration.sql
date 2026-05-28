-- Phase 2 W6 — singleton PayrollConfig table.
-- Admin will edit values via /admin/settings/payroll-config (Phase 3).
-- Seed pre-fills one row with Thai-labor-law defaults.

-- CreateTable
CREATE TABLE "PayrollConfig" (
    "id" UUID NOT NULL,
    "ssoRate" DECIMAL(5,4) NOT NULL,
    "ssoSalaryCap" DECIMAL(12,2) NOT NULL,
    "ssoAmountCap" DECIMAL(12,2) NOT NULL,
    "otMultiplier" DECIMAL(3,2) NOT NULL,
    "cutoffDay" INTEGER NOT NULL DEFAULT 25,
    "absentDeductionPerDay" DECIMAL(12,2) NOT NULL,
    "lateDeduction" DECIMAL(12,2) NOT NULL,
    "earlyLeaveDeduction" DECIMAL(12,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollConfig_pkey" PRIMARY KEY ("id")
);
