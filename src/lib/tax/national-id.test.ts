import { describe, expect, it } from 'vitest';
import { isValidThaiNationalId } from './national-id';

describe('isValidThaiNationalId', () => {
  it('accepts a valid 13-digit id with a correct check digit', () => {
    // Prefix 110170020728 → mod-11 check digit = 5 (verified by hand).
    expect(isValidThaiNationalId('1101700207285')).toBe(true);
  });
  it('rejects a wrong check digit', () => {
    // Same prefix, wrong final digit (9 ≠ 5).
    expect(isValidThaiNationalId('1101700207289')).toBe(false);
  });
  it('rejects wrong length', () => {
    expect(isValidThaiNationalId('12345')).toBe(false);
    expect(isValidThaiNationalId('11017002072891')).toBe(false);
  });
  it('rejects non-digits', () => {
    expect(isValidThaiNationalId('11017002072AB')).toBe(false);
  });
  it('rejects empty', () => {
    expect(isValidThaiNationalId('')).toBe(false);
  });
});
