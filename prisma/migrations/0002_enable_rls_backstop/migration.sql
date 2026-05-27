-- Defense-in-depth: enable RLS on all public tables with zero policies.
-- Service-role key (Prisma) bypasses RLS, so app behavior is unchanged.
-- Anon key access is fully denied — protects against accidental client-side
-- exposure of business data. See docs/v2/architecture.md §1 decision #1.

ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Department" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AccountingGroup" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Branch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkSchedule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Employee" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Attendance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeaveType" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeaveRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CashAdvance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RecurringDeduction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payroll" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Holiday" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
