-- Per-branch payslip letterhead + localized branch name (all optional → null = default)
ALTER TABLE "Branch" ADD COLUMN "nameEn" TEXT;
ALTER TABLE "Branch" ADD COLUMN "payslipNameEn" TEXT;
ALTER TABLE "Branch" ADD COLUMN "payslipNameNative" TEXT;
ALTER TABLE "Branch" ADD COLUMN "payslipLogoKey" TEXT;
