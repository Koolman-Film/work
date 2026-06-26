/**
 * Unit tests for sourceHashFor — the cache key. Two properties matter:
 * trailing/leading whitespace is normalized away (so "hi" and "hi\n" share a
 * cache row), and the digest is a stable lowercase sha256 hex.
 */

import { describe, expect, it } from 'vitest';
import { sourceHashFor } from './hash';

describe('sourceHashFor', () => {
  it('is a 64-char lowercase hex sha256', () => {
    const h = sourceHashFor('hello');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for the same input', () => {
    expect(sourceHashFor('ลาป่วย')).toBe(sourceHashFor('ลาป่วย'));
  });

  it('trims surrounding whitespace before hashing', () => {
    expect(sourceHashFor('  hi \n')).toBe(sourceHashFor('hi'));
  });

  it('distinguishes different content', () => {
    expect(sourceHashFor('a')).not.toBe(sourceHashFor('b'));
  });
});
