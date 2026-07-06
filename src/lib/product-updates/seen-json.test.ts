import { describe, expect, it } from 'vitest';
import { parseSeen } from './seen-json';

describe('parseSeen', () => {
  it('returns [] for null/undefined', () => {
    expect(parseSeen(null)).toEqual([]);
    expect(parseSeen(undefined)).toEqual([]);
  });

  it('passes through a clean string array', () => {
    expect(parseSeen(['a', 'first-run.welcome'])).toEqual(['a', 'first-run.welcome']);
  });

  it('filters out non-string members', () => {
    expect(parseSeen(['a', 1, null, {}, 'b'])).toEqual(['a', 'b']);
  });

  it('returns [] for non-array values', () => {
    expect(parseSeen('a')).toEqual([]);
    expect(parseSeen(42)).toEqual([]);
    expect(parseSeen({ a: 1 })).toEqual([]);
  });
});
