import { describe, expect, it } from 'vitest';
import { payslipZipEntryName } from './zip-name';

describe('payslipZipEntryName', () => {
  it('builds <name>_<month>.pdf, sanitizing path/space chars', () => {
    const seen = new Set<string>();
    expect(payslipZipEntryName('สมชาย ใจดี', '2026-06', seen)).toBe('สมชาย_ใจดี_2026-06.pdf');
  });
  it('strips slashes and control chars that would break a zip path', () => {
    const seen = new Set<string>();
    expect(payslipZipEntryName('a/b\\c', '2026-06', seen)).toBe('a-b-c_2026-06.pdf');
  });
  it('de-dupes collisions with a numeric suffix', () => {
    const seen = new Set<string>();
    expect(payslipZipEntryName('สมชาย', '2026-06', seen)).toBe('สมชาย_2026-06.pdf');
    expect(payslipZipEntryName('สมชาย', '2026-06', seen)).toBe('สมชาย_2026-06 (2).pdf');
    expect(payslipZipEntryName('สมชาย', '2026-06', seen)).toBe('สมชาย_2026-06 (3).pdf');
  });
});
