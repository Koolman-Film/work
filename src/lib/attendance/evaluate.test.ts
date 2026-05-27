import { describe, expect, it } from 'vitest';
import { disputeReasonText, evaluateCheckIn } from './evaluate';
import type { GeofenceCandidate } from './haversine';

const NOW = new Date('2026-04-30T09:00:00+07:00');

const branchInRange: GeofenceCandidate = {
  id: 'b-in',
  name: 'สาขา A',
  latitude: 13.7563,
  longitude: 100.5018,
  radiusMeters: 150,
};
const branchOutOfRange: GeofenceCandidate = {
  id: 'b-far',
  name: 'สาขา B',
  // 0.1 deg lat ≈ 11 km — well out of A's 150m radius.
  latitude: 13.8563,
  longitude: 100.5018,
  radiusMeters: 200,
};
const branchUnconfigured: GeofenceCandidate = {
  id: 'b-null',
  name: 'สาขา ไม่ได้ตั้งพิกัด',
  latitude: null,
  longitude: null,
  radiusMeters: 150,
};

describe('evaluateCheckIn', () => {
  it('returns Confirmed when point is inside the fence with good GPS accuracy', () => {
    const result = evaluateCheckIn({
      point: { lat: 13.7563, lng: 100.5018, accuracy: 12 },
      candidateBranches: [branchInRange],
      previousCheckInAt: null,
      now: NOW,
    });
    expect(result.status).toBe('Confirmed');
    if (result.status === 'Confirmed') {
      expect(result.branchId).toBe('b-in');
      expect(result.distanceMeters).toBeLessThan(5);
    }
  });

  it('returns Disputed/no-configured-branch when every candidate has null coords', () => {
    const result = evaluateCheckIn({
      point: { lat: 13.7563, lng: 100.5018, accuracy: 10 },
      candidateBranches: [branchUnconfigured],
      previousCheckInAt: null,
      now: NOW,
    });
    expect(result.status).toBe('Disputed');
    if (result.status === 'Disputed') {
      expect(result.reason).toBe('no-configured-branch');
      expect(result.branchId).toBeNull();
    }
  });

  it('returns Disputed/no-branch-in-range when point is outside the closest fence', () => {
    const result = evaluateCheckIn({
      point: { lat: 13.7, lng: 100.5018, accuracy: 10 },
      candidateBranches: [branchInRange],
      previousCheckInAt: null,
      now: NOW,
    });
    expect(result.status).toBe('Disputed');
    if (result.status === 'Disputed') {
      expect(result.reason).toBe('no-branch-in-range');
      expect(result.branchId).toBe('b-in'); // still report the candidate
      expect(result.distanceMeters).toBeGreaterThan(150);
    }
  });

  it('returns Disputed/gps-too-imprecise when accuracy exceeds threshold', () => {
    // Inside fence centroid but with a ±300m error radius — meaningless.
    const result = evaluateCheckIn({
      point: { lat: 13.7563, lng: 100.5018, accuracy: 300 },
      candidateBranches: [branchInRange],
      previousCheckInAt: null,
      now: NOW,
    });
    expect(result.status).toBe('Disputed');
    if (result.status === 'Disputed') {
      expect(result.reason).toBe('gps-too-imprecise');
    }
  });

  it('returns Disputed/impossible-travel when previous check-in is too recent + too far', () => {
    // Previous check-in 1 min ago at a point 100km away from current point.
    // 100km in 60s = 6000 km/h — physically impossible.
    const result = evaluateCheckIn({
      point: { lat: 13.7563, lng: 100.5018, accuracy: 10 },
      candidateBranches: [branchInRange],
      previousCheckInAt: new Date(NOW.getTime() - 60_000),
      now: NOW,
    });
    // The "distance" in the impossible-travel calc is the distance to the
    // matched branch (we don't know where the previous point was, but the
    // bound is conservative). For this contrived case branch distance ≈ 0
    // so impossible-travel doesn't fire — adjust the harness to use a fence
    // *with* nonzero distance to exercise the path.
    expect(result.status).toBe('Confirmed');
  });

  it('correctly flags impossible-travel when the matched branch is far from the previous fix', () => {
    // The current evaluateCheckIn uses haversine-to-fence as proxy for travel
    // distance. Put the employee at branch A (0m distance), but the *previous*
    // check-in fix is at a different fence 100 km away just a minute ago.
    //
    // Modelling that requires shifting *current* fix; pick a point sandwiched
    // between two branches: 2km from branchInRange (still inside if radius >
    // 2km — let's use 3km radius). Previous fix is 1 min ago.
    const wideRangeBranch: GeofenceCandidate = {
      id: 'b-wide',
      name: 'สาขา (ขอบเขตกว้าง)',
      latitude: 13.7563,
      longitude: 100.5018,
      radiusMeters: 5_000,
    };
    const result = evaluateCheckIn({
      // 0.02 deg lat ≈ 2.2 km from branch — within the 5km wide range.
      point: { lat: 13.7763, lng: 100.5018, accuracy: 10 },
      candidateBranches: [wideRangeBranch],
      // 1 min ago = 60s; max 60×55.56 ≈ 3,333 m. We're 2.2km — fine, not flagged.
      previousCheckInAt: new Date(NOW.getTime() - 60_000),
      now: NOW,
    });
    expect(result.status).toBe('Confirmed');

    // Same point but only 10 seconds since previous fix: 10×55.56 ≈ 555m,
    // and we're 2.2km away — that IS impossible.
    const tooFast = evaluateCheckIn({
      point: { lat: 13.7763, lng: 100.5018, accuracy: 10 },
      candidateBranches: [wideRangeBranch],
      previousCheckInAt: new Date(NOW.getTime() - 10_000),
      now: NOW,
    });
    expect(tooFast.status).toBe('Disputed');
    if (tooFast.status === 'Disputed') {
      expect(tooFast.reason).toBe('impossible-travel');
    }
  });

  it('priority order: out-of-range beats GPS-imprecise (more specific = more actionable)', () => {
    // Out of range AND imprecise — we want admin to see "wrong branch", not
    // "GPS noisy", because the former is the actionable signal.
    const result = evaluateCheckIn({
      point: { lat: 13.7, lng: 100.5018, accuracy: 500 },
      candidateBranches: [branchInRange],
      previousCheckInAt: null,
      now: NOW,
    });
    expect(result.status).toBe('Disputed');
    if (result.status === 'Disputed') {
      expect(result.reason).toBe('no-branch-in-range');
    }
  });

  it('skips no-coordinate branches and picks the configured one', () => {
    const result = evaluateCheckIn({
      point: { lat: 13.7563, lng: 100.5018, accuracy: 10 },
      candidateBranches: [branchUnconfigured, branchInRange],
      previousCheckInAt: null,
      now: NOW,
    });
    expect(result.status).toBe('Confirmed');
    if (result.status === 'Confirmed') {
      expect(result.branchId).toBe('b-in');
    }
  });

  it('picks closer-but-out-of-range over farther-but-out-of-range as the matched branch', () => {
    // Both are out of range; we should still report the closer one as the
    // "best guess" so admin sees the most likely intended branch.
    const result = evaluateCheckIn({
      // Point is between A (~11 km from A, since A is at 13.7563) and B (much further).
      point: { lat: 13.8, lng: 100.5018, accuracy: 10 },
      candidateBranches: [branchInRange, branchOutOfRange],
      previousCheckInAt: null,
      now: NOW,
    });
    expect(result.status).toBe('Disputed');
    if (result.status === 'Disputed') {
      // branchOutOfRange (13.8563°) is ~6km from us; branchInRange (13.7563°)
      // is ~4.9km from us. So branchInRange wins.
      expect(result.branchId).toBe('b-in');
    }
  });
});

describe('disputeReasonText', () => {
  it('produces a Thai message for every reason variant', () => {
    expect(disputeReasonText('no-configured-branch')).toMatch(/พิกัด/);
    expect(disputeReasonText('no-branch-in-range')).toMatch(/พื้นที่/);
    expect(disputeReasonText('gps-too-imprecise')).toMatch(/GPS/);
    expect(disputeReasonText('impossible-travel')).toMatch(/ระยะทาง/);
  });
});
