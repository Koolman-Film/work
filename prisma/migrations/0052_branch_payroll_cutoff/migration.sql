-- Per-branch payroll cut-off (Central Audio cuts on the last day of the month
-- from the 2026-10 payroll month; every other branch keeps the company day).
--
-- A HISTORY table, not a column on Branch. A month uses the latest row whose
-- fromMonth is on or before it, so adding a row changes only months from its
-- own fromMonth forward. A single editable column would re-window every month
-- the previous value covered — including months already paid.
--
-- Creating the table changes no money: with no rows, every employee keeps
-- PayrollConfig.cutoffDay exactly as before. Rows are added by an admin from
-- /admin/settings/attendance, which writes an audit entry.
CREATE TABLE "BranchPayrollCutoff" (
  "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
  "branchId"    UUID NOT NULL,
  "fromMonth"   TEXT NOT NULL,
  "cutoffDay"   INTEGER NOT NULL,
  "createdById" UUID,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BranchPayrollCutoff_pkey" PRIMARY KEY ("id"),
  -- 29/30 are refused: "the 30th" would mean the 28th in February and a
  -- different day next month. 31 is the explicit "last day of the month".
  CONSTRAINT "BranchPayrollCutoff_cutoffDay_check"
    CHECK (("cutoffDay" BETWEEN 1 AND 28) OR "cutoffDay" = 31),
  CONSTRAINT "BranchPayrollCutoff_fromMonth_check"
    CHECK ("fromMonth" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);

-- Two rules starting the same month would make the window depend on row order.
CREATE UNIQUE INDEX "BranchPayrollCutoff_branchId_fromMonth_key"
  ON "BranchPayrollCutoff" ("branchId", "fromMonth");

-- RESTRICT, not CASCADE: a branch is archived, never deleted, and deleting a
-- branch must not silently re-window its employees' past payslips.
ALTER TABLE "BranchPayrollCutoff"
  ADD CONSTRAINT "BranchPayrollCutoff_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
