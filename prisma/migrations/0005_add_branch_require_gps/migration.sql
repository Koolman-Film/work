-- Per-branch optional GPS check.
--
-- A Branch can now opt OUT of geofence enforcement at LIFF check-in time
-- by setting requireGps=false. This is for office-job branches, remote
-- workers, or any branch where physical co-location with a fence isn't
-- the relevant verification signal.
--
-- Default `false` is intentional: GPS enforcement is opt-in. Existing
-- branches inherit `false` from the column default (NOT NULL DEFAULT
-- false applies to all existing rows) — matching the explicit migration
-- requirement that existing branches do NOT require GPS until admin
-- opts in via the branch edit form.
--
-- The semantic change in the app: when the matched branch has
-- requireGps=false, `evaluateCheckIn` skips the three GPS-derived
-- dispute reasons (no-branch-in-range, gps-too-imprecise,
-- impossible-travel). The branch and distance are still recorded for
-- the admin live board / audit log.

ALTER TABLE "Branch" ADD COLUMN "requireGps" BOOLEAN NOT NULL DEFAULT false;
