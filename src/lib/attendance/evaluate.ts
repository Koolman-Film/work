/**
 * Pure decision engine: given a GPS reading and the employee's assigned
 * branches, decide whether this check-in is `Confirmed` or `Disputed`.
 *
 * The Server Action (check-in.ts) is responsible for I/O — auth, DB load,
 * audit write. This file is responsible for the *judgement* call. Keeping
 * it pure means:
 *   - Trivial to unit-test (no Prisma/Supabase mocks).
 *   - Trivial to reason about (no side effects).
 *   - Easy to evolve the policy (add tolerance for high-accuracy GPS,
 *     adjust impossible-travel thresholds) without touching transaction
 *     code.
 */

import { findClosestBranch, type GeofenceCandidate, isImpossibleTravel } from './haversine';

/**
 * Maximum GPS accuracy radius (metres) we accept as "trustworthy".
 *
 * Modern phones report 5–20m outdoors with a clear sky, 30–60m indoors,
 * and 100–500m+ when relying purely on cell-tower fix. We treat anything
 * above 100m as "the location is too imprecise to confirm — let admin
 * review."
 */
export const ACCURACY_THRESHOLD_M = 100;

export type CheckInPoint = {
  lat: number;
  lng: number;
  /** Browser-reported accuracy radius in metres. */
  accuracy: number;
};

export type EvaluateCheckInInput = {
  point: CheckInPoint;
  candidateBranches: readonly GeofenceCandidate[];
  /**
   * The clockInAt of the employee's most-recent same-day check-in, if any.
   * Used for impossible-travel detection on subsequent check-ins of the day
   * (multi-branch employees, re-check-in after going home for lunch, etc).
   */
  previousCheckInAt: Date | null;
  /** Used by the impossible-travel calc — usually `new Date()`. */
  now: Date;
};

export type EvaluateCheckInResult =
  | {
      status: 'Confirmed';
      branchId: string;
      branchName: string;
      /**
       * Distance from the employee's GPS fix to the matched branch.
       * `null` only when the matched branch has `requireGps=false` AND
       * no lat/lng configured — we have no coords to measure against.
       */
      distanceMeters: number | null;
    }
  | {
      status: 'Disputed';
      /** Best-fit branch the system *would have* matched (for the admin UI). */
      branchId: string | null;
      branchName: string | null;
      distanceMeters: number | null;
      /** Machine-readable reason — drives Thai message + admin filter. */
      reason:
        | 'no-configured-branch'
        | 'no-branch-in-range'
        | 'gps-too-imprecise'
        | 'impossible-travel';
    };

export function evaluateCheckIn(input: EvaluateCheckInInput): EvaluateCheckInResult {
  // 1. Branch match — distance from the closest configured branch.
  const match = findClosestBranch(input.candidateBranches, input.point);

  // Edge case: employee is assigned to branches with no lat/lng. Two sub-cases:
  //
  //   - At least one candidate is GPS-optional (requireGps=false): the
  //     missing coords are intentional ("we don't enforce geofence here"),
  //     so Confirm with the first GPS-optional branch as the matched one.
  //     No distance is available, so we report distanceMeters=null.
  //
  //   - Every candidate has null coords AND every candidate requires GPS:
  //     genuine config gap (admin forgot to set lat/lng). Surface as
  //     Disputed/no-configured-branch so it lands in the review inbox.
  if (!match) {
    const gpsOptional = input.candidateBranches.find((b) => !b.requireGps);
    if (gpsOptional) {
      return {
        status: 'Confirmed',
        branchId: gpsOptional.id,
        branchName: gpsOptional.name,
        distanceMeters: null,
      };
    }
    return {
      status: 'Disputed',
      branchId: null,
      branchName: null,
      distanceMeters: null,
      reason: 'no-configured-branch',
    };
  }

  // 2. Apply the three Disputed triggers in priority order.
  //    Order matters for the `reason` we report — we surface the *most
  //    specific* root cause an admin can act on.
  //
  //    Escape hatch: if the matched branch has requireGps=false, NONE
  //    of the three GPS-derived gates run. The whole point of the flag
  //    is to declare "this branch doesn't care about GPS"; gating on
  //    out-of-range / accuracy / impossible-travel would defeat that.
  //    We still report the matched branch + distance for the audit log
  //    so admins can see where the employee actually was when they
  //    checked in (useful diagnostic even when not enforced).
  if (match.branch.requireGps) {
    // 2a. Out of range — most common failure mode (wrong branch, parking
    //     lot 50m off, etc).
    if (!match.inside) {
      return {
        status: 'Disputed',
        branchId: match.branch.id,
        branchName: match.branch.name,
        distanceMeters: match.distanceMeters,
        reason: 'no-branch-in-range',
      };
    }

    // 2b. GPS accuracy too low — even if the centroid is inside the fence,
    //     a ±200m error radius makes that meaningless.
    if (input.point.accuracy > ACCURACY_THRESHOLD_M) {
      return {
        status: 'Disputed',
        branchId: match.branch.id,
        branchName: match.branch.name,
        distanceMeters: match.distanceMeters,
        reason: 'gps-too-imprecise',
      };
    }

    // 2c. Impossible travel — multi-branch employee checking in at branch B
    //     5 minutes after branch A 100km away.
    if (
      isImpossibleTravel({
        distanceMeters: match.distanceMeters,
        previousCheckInAt: input.previousCheckInAt,
        now: input.now,
      })
    ) {
      return {
        status: 'Disputed',
        branchId: match.branch.id,
        branchName: match.branch.name,
        distanceMeters: match.distanceMeters,
        reason: 'impossible-travel',
      };
    }
  }

  // 3. All signals green.
  return {
    status: 'Confirmed',
    branchId: match.branch.id,
    branchName: match.branch.name,
    distanceMeters: match.distanceMeters,
  };
}

/**
 * Thai user-facing message for a disputed reason. Kept here (not in the
 * client component) so the same string surfaces in the admin disputed-
 * inbox detail panel — single source of truth.
 */
export function disputeReasonText(
  reason: Exclude<EvaluateCheckInResult, { status: 'Confirmed' }>['reason'],
): string {
  switch (reason) {
    case 'no-configured-branch':
      return 'ยังไม่ได้ตั้งพิกัดสาขา — ติดต่อแอดมิน';
    case 'no-branch-in-range':
      return 'อยู่นอกพื้นที่สาขา (geofence)';
    case 'gps-too-imprecise':
      return 'สัญญาณ GPS ไม่แม่นยำพอ — ลองออกที่โล่ง';
    case 'impossible-travel':
      return 'ระยะทางและเวลาไม่สอดคล้องกัน — ต้องตรวจสอบ';
  }
}
