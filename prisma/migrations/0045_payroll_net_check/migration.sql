-- A Payroll row must add up.
--
-- netPay is written by the engine, and every consumer that displays or
-- reconciles a payslip re-derives the same sum independently. When a money
-- component was added (incomeAllowance, 0042) several of those consumers kept
-- the old two-bucket arithmetic: the payslip total, the reconciliation page's
-- gross, and the low-net flag all disagreed with netPay for any employee with
-- an allowance. Nothing failed — the numbers were just quietly wrong.
--
-- The compiler cannot catch a forgotten sum across a Decimal column. Postgres
-- can. This constraint makes an inconsistent row unwritable, and forces the
-- next person who adds a money component to update it in the same migration,
-- because their first INSERT fails until they do.
--
-- Exact, not approximate: every operand is Decimal(12,2), so this is integer
-- satang arithmetic with no floating-point tolerance needed.
--
-- Verified before adding: 331 rows across 2026-06 .. 2027-04 in production,
-- zero violations. The constraint is validated against existing rows (no
-- NOT VALID) precisely so that claim keeps being true.
ALTER TABLE "Payroll" ADD CONSTRAINT "payroll_net_reconciles" CHECK (
  "netPay" = "incomeBase" + "incomeAllowance" + "incomeOther"
           - "deductSso" - "deductAdvance" - "deductAttendance"
           - "deductLeave" - "deductDebt" - "deductOther"
);
