-- Withholding tax (ภาษีหัก ณ ที่จ่าย), phase 1: record it, do not compute it.
--
-- Tax enters as a PayrollAdjustment kind rather than a column an admin types
-- into directly. calcPayroll is pure and recalculation is idempotent only
-- because every admin-entered amount arrives as an INPUT selected by month
-- range; a hand-typed value on the Payroll row would force recalc to read its
-- own prior output to avoid destroying it.
--
-- ALTER TYPE ... ADD VALUE is safe inside Prisma's transaction on PG 12+ so
-- long as the new value is not USED in the same transaction. Nothing here
-- backfills using these values, so this is fine. Do not add a backfill to this
-- file — put it in its own migration.

ALTER TYPE "AdjustmentKind" ADD VALUE 'Tax';

ALTER TYPE "JournalLineKind" ADD VALUE 'WhtPayable';
ALTER TYPE "JournalLineKind" ADD VALUE 'WhtExpense';

-- Tax remitted to the Revenue Department for this employee-month, REGARDLESS
-- of who bears it. netPay subtracts it only when the employee bears it.
ALTER TABLE "Payroll"
  ADD COLUMN "deductTax" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Global kill switch. Default false so deploying this changes no behaviour
-- until an admin turns it on.
ALTER TABLE "PayrollConfig"
  ADD COLUMN "whtEnabled" BOOLEAN NOT NULL DEFAULT false;

-- นายจ้างออกภาษีให้ — the company bears the tax instead of withholding it.
-- Default false: withholding is the norm, and being wrong in that direction
-- shows up as a payslip discrepancy rather than a filing error.
ALTER TABLE "Employee"
  ADD COLUMN "taxBorneByEmployer" BOOLEAN NOT NULL DEFAULT false;

-- Employer tax identity. Nullable because it is unknown until an admin enters
-- it; the ภ.ง.ด.1 route must refuse to emit a file without it (pre-flight 422)
-- rather than emit a blank field.
ALTER TABLE "Branch"
  ADD COLUMN "taxId" TEXT,
  ADD COLUMN "taxBranchNo" TEXT;
