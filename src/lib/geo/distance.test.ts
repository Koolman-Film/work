import { describe, expect, it } from 'vitest';
import { haversineMeters } from './distance';

describe('haversineMeters', () => {
  it('is zero for identical points', () => {
    expect(haversineMeters(13.7563, 100.5018, 13.7563, 100.5018)).toBe(0);
  });
  it('approximates a known short distance (~157m per 0.001° latitude near the equator-ish)', () => {
    // 0.001 degree of latitude ≈ 111 m; assert within tolerance.
    const d = haversineMeters(13.7563, 100.5018, 13.7573, 100.5018);
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(125);
  });
  it('returns a rounded integer', () => {
    const d = haversineMeters(13.75, 100.5, 13.76, 100.51);
    expect(Number.isInteger(d)).toBe(true);
  });
});
