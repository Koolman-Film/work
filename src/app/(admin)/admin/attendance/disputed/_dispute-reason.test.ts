/**
 * Unit tests for isGpsRelatedDispute — the display-time classification that
 * decides whether the disputed-inbox distance is safe to show.
 *
 * A selfie-only dispute is raised only when GPS already said `Confirmed`
 * (selfie-provenance.ts), so `distanceMeters` is real but misleading there —
 * see the CRITICAL finding this guards against ("นอก 5 ม." next to a
 * selfie-provenance reason for someone standing inside the geofence).
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { disputeReasonText } from '@/lib/attendance/evaluate';
import { SELFIE_FALLBACK_REASON } from '@/lib/attendance/selfie-provenance';
import { isGpsRelatedDispute } from './_dispute-reason';

describe('isGpsRelatedDispute', () => {
  it('is false for the selfie-fallback reason', () => {
    expect(isGpsRelatedDispute(SELFIE_FALLBACK_REASON)).toBe(false);
  });

  it.each([
    ['no-configured-branch', disputeReasonText('no-configured-branch')],
    ['no-branch-in-range', disputeReasonText('no-branch-in-range')],
    ['gps-too-imprecise', disputeReasonText('gps-too-imprecise')],
    ['impossible-travel', disputeReasonText('impossible-travel')],
  ] as const)('is true for the GPS reason text of %s', (_label, reasonText) => {
    expect(isGpsRelatedDispute(reasonText)).toBe(true);
  });

  it('treats null as GPS-related — the safe default for rows predating the selfie flag', () => {
    expect(isGpsRelatedDispute(null)).toBe(true);
  });
});
