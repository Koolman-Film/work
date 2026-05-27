import { describe, expect, it } from 'vitest';
import {
  findClosestBranch,
  type GeofenceCandidate,
  haversineMeters,
  isImpossibleTravel,
} from './haversine';

describe('haversineMeters', () => {
  it('returns 0 for identical points', () => {
    expect(haversineMeters(13.7563, 100.5018, 13.7563, 100.5018)).toBe(0);
  });

  it('is symmetric', () => {
    const a = haversineMeters(13.7563, 100.5018, 13.8, 100.6);
    const b = haversineMeters(13.8, 100.6, 13.7563, 100.5018);
    expect(a).toBeCloseTo(b, 6);
  });

  it('matches a hand-computed reference distance', () => {
    // Bangkok (Sanam Luang, ~13.7563°N 100.5018°E) → Pattaya area
    // (~12.9236°N 100.8825°E). Great-circle distance is ~101 km (the road
    // distance is longer — ~150 km via Motorway 7 — but we're measuring
    // straight-line through the Earth).
    const km = haversineMeters(13.7563, 100.5018, 12.9236, 100.8825) / 1000;
    expect(km).toBeGreaterThan(99);
    expect(km).toBeLessThan(103);
  });

  it('handles small distances accurately (geofence scale)', () => {
    // Two points ~111 m apart at Bangkok latitude. 1 deg latitude ≈ 111 km,
    // so 0.001 deg ≈ 111 m. Tolerance ±2m for floating-point + Earth-curvature.
    const m = haversineMeters(13.7563, 100.5018, 13.7573, 100.5018);
    expect(m).toBeGreaterThan(109);
    expect(m).toBeLessThan(113);
  });

  it('clamps the asin argument so no NaN escapes', () => {
    // Antipodal-ish points — pushes the asin argument closest to 1. Real-world
    // ops won't hit this, but a stray NaN here would silently bypass the
    // geofence (NaN <= radius is false, so we'd over-reject — but still bad).
    const result = haversineMeters(90, 0, -90, 0);
    expect(Number.isFinite(result)).toBe(true);
    // Half Earth's circumference at equator ≈ 20015 km.
    expect(result / 1000).toBeGreaterThan(19_900);
    expect(result / 1000).toBeLessThan(20_100);
  });
});

describe('findClosestBranch', () => {
  const branchA: GeofenceCandidate = {
    id: 'a',
    name: 'A',
    latitude: 13.7563,
    longitude: 100.5018,
    radiusMeters: 150,
  };
  const branchB: GeofenceCandidate = {
    id: 'b',
    name: 'B',
    latitude: 13.8,
    longitude: 100.6,
    radiusMeters: 200,
  };
  const branchWithNoFence: GeofenceCandidate = {
    id: 'c',
    name: 'C',
    latitude: null,
    longitude: null,
    radiusMeters: 150,
  };

  it('returns null when no candidates have lat/lng configured', () => {
    expect(findClosestBranch([branchWithNoFence], { lat: 13.75, lng: 100.5 })).toBeNull();
  });

  it('picks the branch nearest the given point', () => {
    // Point right at branchA → A wins.
    const m = findClosestBranch([branchA, branchB], { lat: 13.7563, lng: 100.5018 });
    expect(m?.branch.id).toBe('a');
    expect(m?.distanceMeters).toBeCloseTo(0, 1);
    expect(m?.inside).toBe(true);
  });

  it('flags inside=false when distance > branch.radiusMeters', () => {
    // 0.01 deg lat ≈ 1.1 km north of A; A has 150m radius.
    const m = findClosestBranch([branchA], { lat: 13.7663, lng: 100.5018 });
    expect(m?.branch.id).toBe('a');
    expect(m?.inside).toBe(false);
    expect(m?.distanceMeters).toBeGreaterThan(1000);
  });

  it('skips candidates with null coords but still considers fully-configured ones', () => {
    const m = findClosestBranch([branchWithNoFence, branchA], { lat: 13.7563, lng: 100.5018 });
    // A is returned (C was skipped because it has no coordinates).
    expect(m?.branch.id).toBe('a');
  });
});

describe('isImpossibleTravel', () => {
  const now = new Date('2026-04-30T09:00:00+07:00');

  it('returns false when there is no prior check-in', () => {
    expect(
      isImpossibleTravel({
        distanceMeters: 5000,
        previousCheckInAt: null,
        now,
      }),
    ).toBe(false);
  });

  it('returns false for a realistic commute (5 km in 15 min ~ 20 km/h)', () => {
    expect(
      isImpossibleTravel({
        distanceMeters: 5000,
        previousCheckInAt: new Date('2026-04-30T08:45:00+07:00'),
        now,
      }),
    ).toBe(false);
  });

  it('flags impossible movement (50 km in 5 min — would need 600 km/h)', () => {
    expect(
      isImpossibleTravel({
        distanceMeters: 50_000,
        previousCheckInAt: new Date('2026-04-30T08:55:00+07:00'),
        now,
      }),
    ).toBe(true);
  });

  it('flags a zero-or-negative time gap (clock drift / replay) as impossible', () => {
    // Previous check-in is in the future relative to `now`.
    expect(
      isImpossibleTravel({
        distanceMeters: 100,
        previousCheckInAt: new Date('2026-04-30T10:00:00+07:00'),
        now,
      }),
    ).toBe(true);
  });

  it('allows the edge of the speed limit (≈200 km/h sustained for 30 min)', () => {
    // 100 km in 30 min = 200 km/h exactly — boundary should pass (not >).
    expect(
      isImpossibleTravel({
        distanceMeters: 100_000,
        previousCheckInAt: new Date('2026-04-30T08:30:00+07:00'),
        now,
      }),
    ).toBe(false);
  });
});
