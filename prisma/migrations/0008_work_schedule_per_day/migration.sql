-- Per-day work schedules.
--
-- Before this migration:
--   WorkSchedule { startTime, endTime, workDays: int[] } — same times every day.
-- After:
--   WorkSchedule { ... }
--   WorkScheduleDay { workScheduleId, dayOfWeek, startTime, endTime } — one row
--   per working weekday. Closed days = no row.
--
-- The migration data-converts in three SQL steps so no row is lost:
--
--   1. CREATE WorkScheduleDay table with the new shape.
--   2. INSERT one WorkScheduleDay per (schedule, day-from-workDays).
--      The unnest() expansion gives us one output row per element of
--      the workDays array, carrying the schedule's flat startTime /
--      endTime onto each day. Result: every working day for every
--      schedule keeps its existing hours.
--   3. ALTER TABLE drops the now-redundant startTime/endTime/workDays
--      columns from WorkSchedule.
--
-- gen_random_uuid() requires pgcrypto, which is on by default in
-- Supabase projects.
--
-- Also adds createdAt / updatedAt to WorkSchedule for parity with the
-- other settings entities. NOT NULL defaults backfill existing rows.

CREATE TABLE "WorkScheduleDay" (
  "id"              UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "workScheduleId"  UUID NOT NULL,
  "dayOfWeek"       INTEGER NOT NULL,
  "startTime"       TEXT NOT NULL,
  "endTime"         TEXT NOT NULL,

  CONSTRAINT "WorkScheduleDay_workScheduleId_fkey"
    FOREIGN KEY ("workScheduleId")
    REFERENCES "WorkSchedule"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "WorkScheduleDay_workScheduleId_dayOfWeek_key"
  ON "WorkScheduleDay"("workScheduleId", "dayOfWeek");

CREATE INDEX "WorkScheduleDay_workScheduleId_idx"
  ON "WorkScheduleDay"("workScheduleId");

-- Data migration: explode workDays array into one WorkScheduleDay per day.
INSERT INTO "WorkScheduleDay" ("workScheduleId", "dayOfWeek", "startTime", "endTime")
SELECT
  "id"          AS "workScheduleId",
  unnest("workDays") AS "dayOfWeek",
  "startTime",
  "endTime"
FROM "WorkSchedule";

-- Drop the now-redundant flat columns. Done last so the SELECT above
-- still has access to them.
ALTER TABLE "WorkSchedule" DROP COLUMN "startTime";
ALTER TABLE "WorkSchedule" DROP COLUMN "endTime";
ALTER TABLE "WorkSchedule" DROP COLUMN "workDays";

-- Audit fields — backfill existing rows to "now" so old schedules
-- don't appear as 1970-epoch creations.
ALTER TABLE "WorkSchedule" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "WorkSchedule" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
