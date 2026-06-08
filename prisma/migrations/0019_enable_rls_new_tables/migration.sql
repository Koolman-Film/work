-- ─── 0019 — RLS backstop on Phase 1–3 tables ──────────────────────────────
-- Enable RLS (no policy) on the leave/OT tables, matching the sensitive-table
-- posture of LeaveRequest/Payroll/CashAdvance (migration 0002). The app's
-- Prisma service-role bypasses RLS, so this only closes the public PostgREST
-- exposure of leave balances + OT pay — no app behaviour changes.
ALTER TABLE "LeaveConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeaveEntitlement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OvertimeEntry" ENABLE ROW LEVEL SECURITY;
