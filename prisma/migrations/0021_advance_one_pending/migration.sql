-- One ACTIVE pending cash advance per employee.
--
-- Prisma's schema DSL can't express a partial-unique index, so it lives in raw
-- SQL (same pattern as the Attendance live-key index in 0016). This is the
-- authoritative guard behind the app-level "one pending at a time" check in
-- submitCashAdvance (LIFF) and adminCreateCashAdvance (admin on-behalf) — it
-- closes the check-then-create race those two paths would otherwise share.
--
-- `deletedAt IS NULL` so a voided/soft-deleted pending row doesn't occupy the
-- slot. Verified pre-migration: no employee currently has >1 active-pending
-- advance, so this index applies cleanly.
CREATE UNIQUE INDEX "CashAdvance_one_active_pending_key"
  ON "CashAdvance" ("employeeId")
  WHERE "status" = 'Pending' AND "deletedAt" IS NULL;
