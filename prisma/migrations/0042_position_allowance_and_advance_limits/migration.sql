-- Nameable recurring extra pay ("เงินประจำตำแหน่ง" is the first use, but the
-- label is the admin's to set). Counts toward payroll income and the cash-advance
-- cap; deliberately NOT toward calcSso / perMinuteRate / dailyRateFor.
ALTER TABLE "Employee"
  ADD COLUMN "allowanceLabel"  TEXT,
  ADD COLUMN "allowanceAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Cash-advance limits, both global.
--   advanceMinRemaining: baht that must remain undrawn (0 = no floor)
--   advanceBlackoutDays: days up to and including cutoffDay where requesting is
--                        blocked (0 = off)
ALTER TABLE "PayrollConfig"
  ADD COLUMN "advanceMinRemaining" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "advanceBlackoutDays" INTEGER       NOT NULL DEFAULT 0;

-- The allowance frozen onto a payslip, as its own line rather than folded into
-- incomeOther, so the slip can name it.
ALTER TABLE "Payroll"
  ADD COLUMN "incomeAllowance" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- NOTE: every column here is additive with a default, so existing rows stay
-- valid and a code rollback leaves the database consistent. This migration
-- deliberately adds NO permission — that is what keeps it clear of the
-- permission-strip trap in docs/runbooks/deploy-rollback.md, where rolling back
-- across a DDL boundary lets the next role-settings save drop a permission the
-- migration granted, and re-deploying does not restore it. Do not add one here
-- without re-reading that runbook.
