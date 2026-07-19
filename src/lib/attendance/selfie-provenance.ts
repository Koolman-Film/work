/**
 * Decide the stored check-in status once the GPS verdict and the selfie's
 * provenance are both known.
 *
 * The selfie flag can only ever ADD scrutiny, never remove it: when GPS has
 * already disputed the check-in, its reason is kept, because "you were
 * outside the branch" is more specific and more actionable than "the photo
 * may not be live".
 *
 * The flag is reported by the client, so a determined cheat can lie about
 * it. This is a DETECTION aid, not enforcement — it raises the bar from
 * "tap Deny on the camera prompt" to "tamper with the request". Blocking
 * outright would mean removing the fallback, which is a separate decision.
 */

export type SelfieCapture = 'live' | 'fallback';

// LOAD-BEARING, not just display copy: `isGpsRelatedDispute`
// (admin/attendance/disputed/_dispute-reason.ts) classifies every disputed
// row by comparing its stored `disputeReason` against this exact string to
// decide whether the distance is safe to show. Editing this text — even a
// pure copy fix — silently reclassifies every historical selfie-only dispute
// as GPS-related the next time that comparison runs. If this ever needs to
// change, migrate to a stored enum/code instead of comparing display text.
export const SELFIE_FALLBACK_REASON = 'รูปเซลฟี่ไม่ได้มาจากกล้องสด — อาจเลือกจากแกลเลอรี';

type GpsVerdict = { status: 'Confirmed' } | { status: 'Disputed'; reason: string };

export function resolveCheckInStatus(
  verdict: GpsVerdict,
  capture: SelfieCapture | undefined,
  hasSelfie: boolean,
): { status: 'Confirmed' | 'Disputed'; disputeReason: string | null } {
  if (verdict.status === 'Disputed') {
    return { status: 'Disputed', disputeReason: verdict.reason };
  }
  // Only meaningful when a selfie was actually stored — branches that don't
  // require one must not be flagged.
  if (capture === 'fallback' && hasSelfie) {
    return { status: 'Disputed', disputeReason: SELFIE_FALLBACK_REASON };
  }
  return { status: 'Confirmed', disputeReason: null };
}
