-- Cap how much over-quota LEAVE one payroll month may recover.
--
-- The sweep has no lower date bound: every approved over-quota request never
-- swept into a published payroll is charged, however old. Remembering the debt
-- is correct; collecting all of it at once is not — that is how a ฿13,500
-- salary met a ฿27,450 deduction and a net of −฿14,625 on 2026-08-03.
--
-- Ships OFF (0 = no cap, the behaviour before this migration). 0 does NOT mean
-- "collect nothing" — see monthlyLeaveCap in src/lib/leave/collection-cap.ts.
--
-- Deliberately not 30, or any other live value: a migration must never change
-- computed money. A non-zero default here would re-slice every employee's
-- leave collection the instant it deployed, with no admin action and no audit
-- row naming the decision. An admin enables it from /admin/settings/payroll,
-- which audit-logs before/after and is reversible without a redeploy.
--
-- It also matters WHICH way this defaults. A cap carries the uncollected
-- remainder into later months; the customer's requirement for over-quota leave
-- is "หักเงินไปเลย" — deduct immediately, do not carry. Off is therefore both
-- the safe default and the one matching current expectations.
--
-- NOTE FOR THE CUSTOMER'S ACCOUNTANT: Thai labour law limits what may be
-- deducted from wages. Whether unpaid over-quota leave counts as a "deduction"
-- for that purpose, and what ceiling applies, is a compliance question — 30%
-- is an engineering default, not legal advice.
ALTER TABLE "PayrollConfig"
  ADD COLUMN "leaveDeductMaxPercent" INTEGER NOT NULL DEFAULT 0;

-- How much of a request's deduction has already been collected. A capped month
-- collects part of a large request; the rest carries forward. Only a fully
-- settled request gets deductedInPayrollId stamped, so a partial one stays
-- sweepable and the remainder is not silently forgiven.
ALTER TABLE "LeaveRequest"
  ADD COLUMN "deductedAmountToDate" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Backfill: a request already stamped as paid was collected IN FULL under the
-- old uncapped behaviour, so its collected-to-date equals its frozen deduction.
-- Without this, every historical settled request would look 100% outstanding
-- and be re-charged the moment anything recomputed it.
UPDATE "LeaveRequest"
SET "deductedAmountToDate" = COALESCE("deductAmount", 0)
WHERE "deductedInPayrollId" IS NOT NULL;
