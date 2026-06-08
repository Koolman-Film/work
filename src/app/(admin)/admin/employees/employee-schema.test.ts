import { describe, expect, it } from 'vitest';
import { readForm } from './employee-schema';

const BRANCH_ID = '11111111-1111-1111-1111-111111111111';
const BANK_ID = '22222222-2222-2222-2222-222222222222';

/** Build a FormData with all required fields, overridable per test. */
function buildForm(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const base: Record<string, string> = {
    firstName: 'สมชาย',
    lastName: 'ใจดี',
    branchId: BRANCH_ID,
    salaryType: 'Monthly',
    baseSalary: '25000',
    status: 'Active',
    hiredAt: '2024-03-01',
  };
  for (const [k, v] of Object.entries({ ...base, ...overrides })) fd.set(k, v);
  return fd;
}

describe('readForm — new profile fields', () => {
  it('parses a date of birth into a Date', () => {
    const r = readForm(buildForm({ dateOfBirth: '2000-05-20' }));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.dateOfBirth?.toISOString().slice(0, 10)).toBe('2000-05-20');
  });

  it('treats a blank date of birth as null (clearable)', () => {
    const r = readForm(buildForm({ dateOfBirth: '' }));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.dateOfBirth).toBeNull();
  });

  it('normalizes the bank account number to bare digits', () => {
    const r = readForm(buildForm({ bankId: BANK_ID, bankAccountNumber: '123-456-7890' }));
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.bankId).toBe(BANK_ID);
      expect(r.data.bankAccountNumber).toBe('1234567890');
    }
  });

  it('clears bank fields when blank', () => {
    const r = readForm(buildForm({ bankId: '', bankAccountNumber: '', bankAccountName: '' }));
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.bankId).toBeNull();
      expect(r.data.bankAccountNumber).toBeNull();
      expect(r.data.bankAccountName).toBeNull();
    }
  });

  it('rejects an account number that is too short', () => {
    const r = readForm(buildForm({ bankAccountNumber: '12' }));
    expect(r.success).toBe(false);
  });

  it('keeps photoKey as a string, blank → null', () => {
    const set = readForm(buildForm({ photoKey: 'uid/employee-photos/abc.jpg' }));
    const cleared = readForm(buildForm({ photoKey: '' }));
    expect(set.success && set.data.photoKey).toBe('uid/employee-photos/abc.jpg');
    expect(cleared.success && cleared.data.photoKey).toBeNull();
  });
});
