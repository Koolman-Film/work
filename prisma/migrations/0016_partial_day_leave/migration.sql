-- ─── 0016 — Partial-day leave ─────────────────────────────────────────────
-- Adds the LeaveUnit enum, per-type granularity flags, per-request unit +
-- segment + chargedMinutes, and the LeaveConfig singleton. Relaxes the
-- Attendance partial-unique to EXCLUDE OnLeave so a date can hold two disjoint
-- partial leaves (morning + afternoon). See spec §Phase 1.

CREATE TYPE "LeaveUnit" AS ENUM ('FullDay', 'HalfMorning', 'HalfAfternoon', 'Hourly');

ALTER TABLE "LeaveType" ADD COLUMN "allowFullDay" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "LeaveType" ADD COLUMN "allowHalfDay" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LeaveType" ADD COLUMN "allowHourly"  BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "LeaveRequest" ADD COLUMN "unit" "LeaveUnit" NOT NULL DEFAULT 'FullDay';
ALTER TABLE "LeaveRequest" ADD COLUMN "startTime" TEXT;
ALTER TABLE "LeaveRequest" ADD COLUMN "endTime" TEXT;
ALTER TABLE "LeaveRequest" ADD COLUMN "chargedMinutes" INTEGER;

CREATE TABLE "LeaveConfig" (
    "id" UUID NOT NULL,
    "morningStart" TEXT NOT NULL DEFAULT '09:00',
    "morningEnd" TEXT NOT NULL DEFAULT '12:00',
    "afternoonStart" TEXT NOT NULL DEFAULT '13:00',
    "afternoonEnd" TEXT NOT NULL DEFAULT '17:00',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LeaveConfig_pkey" PRIMARY KEY ("id")
);

-- Seed the singleton row (gen_random_uuid is available on Supabase Postgres).
INSERT INTO "LeaveConfig" ("id", "updatedAt") VALUES (gen_random_uuid(), CURRENT_TIMESTAMP);

-- Relax the Attendance live-unique to exclude OnLeave so a date may hold
-- multiple OnLeave rows (two disjoint partial leaves). Other types keep
-- one-per-(employee,date,type).
DROP INDEX IF EXISTS "Attendance_employeeId_date_type_live_key";
CREATE UNIQUE INDEX "Attendance_employeeId_date_type_live_key"
  ON "Attendance" ("employeeId", "date", "type")
  WHERE "deletedAt" IS NULL AND "type" <> 'OnLeave';
