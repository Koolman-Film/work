import { describe, expect, it } from 'vitest';
import { resolveCheckInStatus } from './selfie-provenance';

const GPS_OK = { status: 'Confirmed' as const };
const GPS_BAD = { status: 'Disputed' as const, reason: 'อยู่นอกพื้นที่สาขา (geofence)' };

describe('resolveCheckInStatus', () => {
  it('live capture + good GPS → Confirmed, no reason', () => {
    expect(resolveCheckInStatus(GPS_OK, 'live', true)).toEqual({
      status: 'Confirmed',
      disputeReason: null,
    });
  });

  it('fallback capture + good GPS → Disputed with the selfie reason', () => {
    const r = resolveCheckInStatus(GPS_OK, 'fallback', true);
    expect(r.status).toBe('Disputed');
    expect(r.disputeReason).toContain('กล้องสด');
  });

  it('fallback capture + bad GPS keeps the GPS reason (never overwritten)', () => {
    expect(resolveCheckInStatus(GPS_BAD, 'fallback', true)).toEqual({
      status: 'Disputed',
      disputeReason: GPS_BAD.reason,
    });
  });

  it('fallback but no selfie on file → not flagged', () => {
    expect(resolveCheckInStatus(GPS_OK, 'fallback', false)).toEqual({
      status: 'Confirmed',
      disputeReason: null,
    });
  });

  it('missing capture info is treated as live (older clients)', () => {
    expect(resolveCheckInStatus(GPS_OK, undefined, true).status).toBe('Confirmed');
  });
});
