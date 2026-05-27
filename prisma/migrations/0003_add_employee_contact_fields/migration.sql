-- Sprint 2.1 (/liff/profile) — employee-managed contact fields.
-- All optional; admins may also edit via /admin/employees/[id]/edit.

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN "address" TEXT,
ADD COLUMN "emergencyContact" TEXT,
ADD COLUMN "personalEmail" TEXT,
ADD COLUMN "phone" TEXT;
