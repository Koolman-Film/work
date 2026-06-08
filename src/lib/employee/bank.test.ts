import { describe, expect, it } from 'vitest';
import { maskBankAccountNumber, normalizeBankAccountNumber } from './bank';

describe('normalizeBankAccountNumber', () => {
  it('strips spaces and dashes to bare digits', () => {
    expect(normalizeBankAccountNumber('123-4-56789-0')).toBe('1234567890');
    expect(normalizeBankAccountNumber('012 345 6789')).toBe('0123456789');
  });

  it('returns null for empty / whitespace / nullish input', () => {
    expect(normalizeBankAccountNumber('')).toBeNull();
    expect(normalizeBankAccountNumber('   ')).toBeNull();
    expect(normalizeBankAccountNumber(null)).toBeNull();
    expect(normalizeBankAccountNumber(undefined)).toBeNull();
  });
});

describe('maskBankAccountNumber', () => {
  it('keeps only the last 4 digits visible', () => {
    expect(maskBankAccountNumber('1234567890')).toBe('••••••7890');
  });

  it('does not mask very short values', () => {
    expect(maskBankAccountNumber('123')).toBe('123');
    expect(maskBankAccountNumber('1234')).toBe('1234');
  });

  it('returns null for nullish input', () => {
    expect(maskBankAccountNumber(null)).toBeNull();
    expect(maskBankAccountNumber('')).toBeNull();
  });
});
