/**
 * Haversine distance + geofence helpers.
 *
 * All functions here are pure — no I/O, no globals. The Server Action
 * calls them with values it already fetched from the DB. That separation
 * keeps the security-critical "are you inside the fence" decision unit-
 * testable without a Prisma stub.
 *
 * Why Haversine (great-circle) rather than equirectangular approximation:
 *   - The branches in this business are 50–500m radius geofences. At
 *     Thailand latitude (~13–20°N), the equirectangular shortcut is
 *     accurate to <1% — fine — but the difference in compute cost is
 *     negligible for the ≤20 employees × ≤10 branches lookup we do.
 *   - Haversine has the nice property that it's symmetric and never
 *     produces a negative result, so we don't have to special-case
 *     anti-meridian or sign-flip edge cases.
 */

/** Mean Earth radius in metres (WGS-84 spheroid mean). */
const EARTH_RADIUS_M = 6371000;

/**
 * Great-circle distance between two lat/lng points, in metres.
 *
 * Coordinates are in decimal degrees (WGS-84). Order is (lat, lng) to
 * match every other geolocation API on Earth, including
 * `GeolocationCoordinates`.
 */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lng2 - lng1);

  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;

  // Clamp to [0, 1] before asin to defend against floating-point drift
  // making `a` infinitesimally > 1, which would NaN the result.
  const c = 2 * Math.asin(Math.min(1, Math.sqrt(a)));

  return EARTH_RADIUS_M * c;
}

/** Branch shape we need for the geofence check — bare minimum. */
export type GeofenceCandidate = {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number;
  /**
   * Per-branch policy: when false, this branch accepts check-ins
   * regardless of distance / GPS accuracy / impossible-travel. The
   * branch still participates in `findClosestBranch` (so we can record
   * which branch the employee was nearest), but `evaluateCheckIn` will
   * not emit a Disputed result on the GPS-derived reasons when the
   * matched branch is GPS-optional.
   */
  requireGps: boolean;
};

export type GeofenceMatch = {
  branch: GeofenceCandidate;
  distanceMeters: number;
  /** True iff distanceMeters ≤ branch.radiusMeters. */
  inside: boolean;
};

/**
 * Given the employee's current point and the branches they're assigned to,
 * pick the closest one that has a geofence configured and report the
 * distance.
 *
 * Returns `null` if every candidate has missing lat/lng (geofence not
 * configured) — the caller should treat that as "branch isn't gated, just
 * accept the check-in". This matches the schema comment on Branch.lat/lng:
 *   "Null lat/lng = no geofence enforcement on LIFF check-in."
 */
export function findClosestBranch(
  candidates: readonly GeofenceCandidate[],
  point: { lat: number; lng: number },
): GeofenceMatch | null {
  let best: GeofenceMatch | null = null;

  for (const c of candidates) {
    if (c.latitude == null || c.longitude == null) continue;

    const distance = haversineMeters(point.lat, point.lng, c.latitude, c.longitude);
    if (best == null || distance < best.distanceMeters) {
      best = {
        branch: c,
        distanceMeters: distance,
        inside: distance <= c.radiusMeters,
      };
    }
  }

  return best;
}

/**
 * Impossible-travel heuristic.
 *
 * Returns true if the gap between `previousCheckInAt` and `now` is too
 * short to plausibly have travelled `distanceMeters`. We use 200 km/h as
 * the upper bound — comfortably above motorway speed, well below
 * commercial aircraft, accounts for GPS noise on stationary devices.
 *
 * Why this matters: someone using a GPS spoofer to "check in" from
 * multiple branches in a short window will trip this. Real employees
 * driving between branches won't, because they're going << 200 km/h.
 *
 * Caller passes `previousCheckInAt = null` when there's no prior same-day
 * record; we return false (not impossible-by-default) in that case.
 */
export function isImpossibleTravel(args: {
  distanceMeters: number;
  previousCheckInAt: Date | null;
  now: Date;
}): boolean {
  if (!args.previousCheckInAt) return false;

  const seconds = (args.now.getTime() - args.previousCheckInAt.getTime()) / 1000;
  if (seconds <= 0) return true; // Time travel is impossible. So is a stale clock — flag it.

  // 200 km/h = 55.56 m/s
  const maxMetersPerSecond = 200_000 / 3600;
  const maxPlausibleDistance = seconds * maxMetersPerSecond;

  return args.distanceMeters > maxPlausibleDistance;
}
