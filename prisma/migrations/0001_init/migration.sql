-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('Employee', 'Admin', 'Owner');

-- CreateEnum
CREATE TYPE "AttSource" AS ENUM ('Liff', 'Excel', 'Both', 'Manual');

-- CreateEnum
CREATE TYPE "AttType" AS ENUM ('CheckIn', 'CheckOut', 'Absent', 'Late', 'EarlyLeave', 'OnLeave');

-- CreateEnum
CREATE TYPE "CheckInStatus" AS ENUM ('Confirmed', 'Disputed', 'Rejected');

-- CreateEnum
CREATE TYPE "SalaryType" AS ENUM ('Monthly', 'Daily', 'Hourly');

-- CreateEnum
CREATE TYPE "EmpStatus" AS ENUM ('Probation', 'Active', 'Archived');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('Pending', 'Approved', 'Rejected', 'Cancelled');

-- CreateEnum
CREATE TYPE "AdvanceStatus" AS ENUM ('Pending', 'Approved', 'Rejected', 'Cancelled');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('Draft', 'Published', 'Locked');

-- CreateEnum
CREATE TYPE "NotifChannel" AS ENUM ('LineMessage', 'InAppBell');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "authUserId" UUID,
    "email" TEXT,
    "lineUserId" TEXT,
    "role" "Role" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingGroup" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "peakCode" TEXT,
    "description" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "radiusMeters" INTEGER NOT NULL DEFAULT 150,
    "requireSelfie" BOOLEAN NOT NULL DEFAULT false,
    "attendanceSource" "AttSource" NOT NULL DEFAULT 'Liff',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkSchedule" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "workDays" INTEGER[],
    "lateToleranceMin" INTEGER NOT NULL DEFAULT 15,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "WorkSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "nickname" TEXT,
    "branchId" UUID NOT NULL,
    "assignedBranchIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "departmentId" UUID,
    "accountingGroupId" UUID,
    "workScheduleId" UUID,
    "salaryType" "SalaryType" NOT NULL,
    "baseSalary" DECIMAL(12,2) NOT NULL,
    "status" "EmpStatus" NOT NULL,
    "canCheckIn" BOOLEAN NOT NULL DEFAULT true,
    "hiredAt" DATE NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "inviteToken" TEXT,
    "inviteExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "type" "AttType" NOT NULL,
    "source" "AttSource" NOT NULL,
    "durationMinutes" INTEGER,
    "clockInAt" TIMESTAMP(3),
    "clockOutAt" TIMESTAMP(3),
    "checkInLat" DECIMAL(10,7),
    "checkInLng" DECIMAL(10,7),
    "checkInBranchId" UUID,
    "checkInSelfieUrl" TEXT,
    "checkInStatus" "CheckInStatus",
    "disputeReason" TEXT,
    "leaveRequestId" UUID,
    "deductAmount" DECIMAL(12,2),
    "isOverridden" BOOLEAN NOT NULL DEFAULT false,
    "overrideNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID NOT NULL,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveType" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isPaid" BOOLEAN NOT NULL DEFAULT true,
    "annualQuota" INTEGER,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "LeaveType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "leaveTypeId" UUID NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "attachmentUrl" TEXT,
    "status" "LeaveStatus" NOT NULL,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashAdvance" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "AdvanceStatus" NOT NULL,
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "receiptUrl" TEXT,
    "isDeducted" BOOLEAN NOT NULL DEFAULT false,
    "deductedInPayrollId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashAdvance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringDeduction" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "monthlyAmount" DECIMAL(12,2) NOT NULL,
    "monthsRemaining" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringDeduction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payroll" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "incomeBase" DECIMAL(12,2) NOT NULL,
    "incomeOther" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "deductSso" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "deductAdvance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "deductAttendance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "deductDebt" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netPay" DECIMAL(12,2) NOT NULL,
    "status" "PayrollStatus" NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "pdfUrl" TEXT,
    "revisionOfId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payroll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "isSubstitute" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "channel" "NotifChannel" NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "readAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "beforeValue" JSONB,
    "afterValue" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_authUserId_key" ON "User"("authUserId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_lineUserId_key" ON "User"("lineUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Department_name_key" ON "Department"("name");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingGroup_name_key" ON "AccountingGroup"("name");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingGroup_peakCode_key" ON "AccountingGroup"("peakCode");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_name_key" ON "Branch"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_userId_key" ON "Employee"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_inviteToken_key" ON "Employee"("inviteToken");

-- CreateIndex
CREATE INDEX "Employee_branchId_idx" ON "Employee"("branchId");

-- CreateIndex
CREATE INDEX "Employee_departmentId_idx" ON "Employee"("departmentId");

-- CreateIndex
CREATE INDEX "Employee_status_idx" ON "Employee"("status");

-- CreateIndex
CREATE INDEX "Attendance_date_idx" ON "Attendance"("date");

-- CreateIndex
CREATE INDEX "Attendance_employeeId_date_idx" ON "Attendance"("employeeId", "date");

-- CreateIndex
CREATE INDEX "Attendance_checkInStatus_idx" ON "Attendance"("checkInStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_employeeId_date_type_key" ON "Attendance"("employeeId", "date", "type");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveType_name_key" ON "LeaveType"("name");

-- CreateIndex
CREATE INDEX "LeaveRequest_employeeId_status_idx" ON "LeaveRequest"("employeeId", "status");

-- CreateIndex
CREATE INDEX "LeaveRequest_status_idx" ON "LeaveRequest"("status");

-- CreateIndex
CREATE INDEX "CashAdvance_employeeId_status_idx" ON "CashAdvance"("employeeId", "status");

-- CreateIndex
CREATE INDEX "CashAdvance_status_idx" ON "CashAdvance"("status");

-- CreateIndex
CREATE INDEX "CashAdvance_isDeducted_idx" ON "CashAdvance"("isDeducted");

-- CreateIndex
CREATE INDEX "RecurringDeduction_employeeId_endedAt_idx" ON "RecurringDeduction"("employeeId", "endedAt");

-- CreateIndex
CREATE INDEX "Payroll_month_idx" ON "Payroll"("month");

-- CreateIndex
CREATE INDEX "Payroll_status_idx" ON "Payroll"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Payroll_employeeId_month_key" ON "Payroll"("employeeId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_date_key" ON "Holiday"("date");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_accountingGroupId_fkey" FOREIGN KEY ("accountingGroupId") REFERENCES "AccountingGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_workScheduleId_fkey" FOREIGN KEY ("workScheduleId") REFERENCES "WorkSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_checkInBranchId_fkey" FOREIGN KEY ("checkInBranchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_leaveRequestId_fkey" FOREIGN KEY ("leaveRequestId") REFERENCES "LeaveRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashAdvance" ADD CONSTRAINT "CashAdvance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringDeduction" ADD CONSTRAINT "RecurringDeduction_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payroll" ADD CONSTRAINT "Payroll_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payroll" ADD CONSTRAINT "Payroll_revisionOfId_fkey" FOREIGN KEY ("revisionOfId") REFERENCES "Payroll"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

