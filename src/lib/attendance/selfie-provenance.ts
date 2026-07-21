/**
 * How a check-in selfie was captured — reported by the client, recorded in
 * the audit log, and deliberately NOT used to judge the check-in.
 *
 * ## Why this no longer disputes a check-in
 *
 * Until 2026-07-21 a `fallback` capture forced `status = Disputed` with the
 * reason "the selfie may have been picked from the gallery". Production said
 * that was wrong:
 *
 *   - ~16% of ALL check-ins (7 of 45/day) were auto-disputed on this alone.
 *   - The split was per-person and sticky, not per-device: 6 of 8 affected
 *     employees were fallback on 100% of their check-ins, on hardware and
 *     LINE builds where their colleagues succeeded (Android 42 live/11
 *     fallback, iOS 33 live/3 fallback). That is a camera permission the OS
 *     remembers as denied — not a behaviour, and not evidence of anything.
 *   - The fallback `<input capture="user">` opens the camera app directly on
 *     most Android phones, so the accusation was frequently impossible: no
 *     gallery was ever offered.
 *
 * So the same honest employees were sent to the admin review queue every
 * single day, for a phone setting. GPS alone decides Confirmed vs Disputed.
 *
 * The signal itself is kept: `submitCheckIn` writes it to
 * `AuditLog.afterValue.selfieCapture` on every check-in, which is where the
 * numbers above came from. That is enough to reason about fallback usage
 * without putting a column on `Attendance` that nothing reads.
 *
 * If fallback ever needs to gate check-in again, do it on evidence this
 * module cannot currently see: `startCamera` (liff/check-in/selfie-step.tsx)
 * swallows the DOMException, so `NotAllowedError` — permission denied, photo
 * is still live — is indistinguishable from a device that genuinely cannot
 * capture. Record the error name first, then decide.
 */

export type SelfieCapture = 'live' | 'fallback';
