-- OverQuotaPolicy enum: controls whether over-quota leave is blocked or
-- triggers a salary deduction.
CREATE TYPE "OverQuotaPolicy" AS ENUM ('Block', 'DeductPay');

-- LeaveType.overQuotaPolicy — default DeductPay (existing types keep pay-deduct
-- behaviour; the one-time fix below flips vacation to Block).
ALTER TABLE "LeaveType" ADD COLUMN "overQuotaPolicy" "OverQuotaPolicy" NOT NULL DEFAULT 'DeductPay';

-- LeaveRequest: frozen over-quota fields (set at approval time, null = within quota).
ALTER TABLE "LeaveRequest" ADD COLUMN "overQuotaMinutes" INTEGER;
ALTER TABLE "LeaveRequest" ADD COLUMN "deductAmount" DECIMAL(12, 2);
ALTER TABLE "LeaveRequest" ADD COLUMN "deductedInPayrollId" UUID;

-- Payroll: accumulated leave deductions for the pay period.
ALTER TABLE "Payroll" ADD COLUMN "deductLeave" DECIMAL(12, 2) NOT NULL DEFAULT 0;

-- One-time policy fix: vacation must not exceed quota. Matching by name here is
-- safe because this runs exactly once per environment at migrate-time; runtime
-- code never matches by name (names are admin-editable + localized).
UPDATE "LeaveType" SET "overQuotaPolicy" = 'Block' WHERE "name" IN ('ลาพักร้อน', 'พักร้อน');
