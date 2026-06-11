-- ─── 0027 — Payroll adjustments (เงินเพิ่ม/เงินลด) + per-employee SSO ───────
-- 1. PayrollAdjustment: admin-entered earnings/deductions. Applies to month M
--    iff startMonth <= M <= coalesce(endMonth, '9999-12'); one-time rows have
--    startMonth = endMonth, open-ended monthly rows have endMonth NULL.
-- 2. Employee.hasSso: social-security enrollment toggle. Default FALSE —
--    admin explicitly ticks enrolled employees before the first payroll run.
-- 3. Payroll.deductOther: bucket for Deduction-kind adjustments (Income-kind
--    fills the pre-existing incomeOther column).

CREATE TYPE "AdjustmentKind" AS ENUM ('Income', 'Deduction');

CREATE TABLE "PayrollAdjustment" (
    "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
    "employeeId" UUID NOT NULL,
    "kind"       "AdjustmentKind" NOT NULL,
    "reason"     TEXT NOT NULL,
    "amount"     DECIMAL(12,2) NOT NULL,
    "startMonth" TEXT NOT NULL,
    "endMonth"   TEXT,
    "note"       TEXT,
    "deletedAt"  TIMESTAMP(3),
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollAdjustment_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PayrollAdjustment"
    ADD CONSTRAINT "PayrollAdjustment_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "Employee"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "PayrollAdjustment_employeeId_startMonth_idx"
    ON "PayrollAdjustment"("employeeId", "startMonth");
CREATE INDEX "PayrollAdjustment_deletedAt_idx"
    ON "PayrollAdjustment"("deletedAt");

-- Sensitive pay data — same RLS backstop posture as Payroll (0002) and the
-- Phase 1–3 tables (0019). App access goes through the service role.
ALTER TABLE "PayrollAdjustment" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "Employee"
    ADD COLUMN "hasSso" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Payroll"
    ADD COLUMN "deductOther" DECIMAL(12,2) NOT NULL DEFAULT 0;
