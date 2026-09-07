-- Chart-of-accounts mapping for the payroll journal export.
--
-- One account per payroll line KIND, not a debit/credit pair: which side a
-- bucket lands on is intrinsic to what it is (salary is always an expense,
-- net pay is always a payable), so making it configurable would only create a
-- way to produce an unbalanced entry.
--
-- `accountCode` is TEXT and deliberately opaque. The three targets name an
-- account three incompatible ways — PEAK assigns its own 6-digit codes,
-- FlowAccount wants an internal numeric id, QuickBooks wants the account NAME
-- as a string — so treating this as "the account code" would bake one vendor's
-- model into the schema.
--
-- Scoped per branch because the branches are separate registered companies and
-- therefore have separate charts of accounts.
CREATE TYPE "JournalLineKind" AS ENUM (
  'SalaryExpense',
  'AllowanceExpense',
  'OtherIncomeExpense',
  'SsoEmployerExpense',
  'SsoPayable',
  'AdvanceRecovery',
  'AttendancePenalty',
  'LeaveDeduction',
  'DebtRecovery',
  'OtherDeduction',
  'NetPayable'
);

CREATE TABLE "AccountMapping" (
  "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
  "branchId"    UUID NOT NULL,
  "lineKind"    "JournalLineKind" NOT NULL,
  "accountCode" TEXT NOT NULL,
  "accountName" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AccountMapping_pkey" PRIMARY KEY ("id")
);

-- One account per kind per branch. The export reads this as a lookup, so a
-- duplicate would make the emitted journal depend on row order.
CREATE UNIQUE INDEX "AccountMapping_branchId_lineKind_key"
  ON "AccountMapping" ("branchId", "lineKind");

ALTER TABLE "AccountMapping"
  ADD CONSTRAINT "AccountMapping_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
