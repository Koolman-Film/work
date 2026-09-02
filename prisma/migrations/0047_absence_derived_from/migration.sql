-- Master switch for derived absence. NULL = feature OFF, which is the state
-- every existing row takes, so this deploy changes nobody's pay. No date before
-- this one ever derives an absence: the lower bound the leave sweep never had
-- (see the ฿27,450 incident, 2026-08-03).
ALTER TABLE "PayrollConfig" ADD COLUMN "absenceDerivedFrom" DATE;
