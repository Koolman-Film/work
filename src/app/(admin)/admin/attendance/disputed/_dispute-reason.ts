import 'server-only';

import { SELFIE_FALLBACK_REASON } from '@/lib/attendance/selfie-provenance';

/**
 * Is this disputed check-in's reason GPS-related (bad location / geofence /
 * imprecise signal / impossible travel) as opposed to selfie-provenance-only?
 *
 * A selfie-only dispute is raised ONLY when the GPS verdict was already
 * `Confirmed` (see selfie-provenance.ts) — meaning checkInLat/Lng and
 * checkInBranch are valid and nearby, so `distanceMeters` is a small, real,
 * but MISLEADING number to show next to "the selfie wasn't live". Every
 * other stored `disputeReason` — the four `disputeReasonText` outputs, and
 * `null` for rows predating this feature — IS GPS-related, and the distance
 * is meaningful for those.
 *
 * `null` defaults to GPS-related (true): every disputed row created before
 * the selfie-provenance flag shipped predates the fallback reason string
 * entirely, so treating an unrecognized/missing reason as GPS-related is the
 * safe default — it must not silently suppress a real distance.
 */
export function isGpsRelatedDispute(disputeReason: string | null): boolean {
  return disputeReason !== SELFIE_FALLBACK_REASON;
}
