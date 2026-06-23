-- Configurable, money-based late-penalty policy (C9).
--   - "N lates in a pay period = 1 day deducted" (replaces the flat per-late
--     charge when enabled).
--   - A "severe" late (more than N minutes past start) on a day with no
--     approved leave = 1 day deducted.
-- The "1 day" amount reuses absentDeductionPerDay. No new permission — the
-- settings page is gated by the existing settings.attendance.manage.

ALTER TABLE "PayrollConfig" ADD COLUMN "lateThreeStrikeEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "PayrollConfig" ADD COLUMN "lateThreeStrikeCount" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "PayrollConfig" ADD COLUMN "severeLateEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "PayrollConfig" ADD COLUMN "severeLateThresholdMin" INTEGER NOT NULL DEFAULT 30;
