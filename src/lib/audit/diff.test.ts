import { describe, expect, it } from 'vitest';
import { diffValues, formatValue } from './diff';

describe('formatValue', () => {
  it('renders null/undefined as an em dash', () => {
    expect(formatValue(null)).toBe('—');
    expect(formatValue(undefined)).toBe('—');
  });
  it('renders booleans in Thai', () => {
    expect(formatValue(true)).toBe('ใช่');
    expect(formatValue(false)).toBe('ไม่ใช่');
  });
  it('renders numbers with thousands separators', () => {
    expect(formatValue(25000)).toBe('25,000');
  });
  it('passes strings through', () => {
    expect(formatValue('Active')).toBe('Active');
  });
  it('stringifies objects/arrays', () => {
    expect(formatValue(['a', 'b'])).toBe('["a","b"]');
  });
});

describe('diffValues', () => {
  it('returns one row per changed field with formatted before/after', () => {
    const rows = diffValues({ baseSalary: 25000 }, { baseSalary: 28000 });
    expect(rows).toEqual([
      {
        field: 'baseSalary',
        label: 'เงินเดือนฐาน',
        before: '25,000',
        after: '28,000',
        changed: true,
      },
    ]);
  });
  it('marks added and removed fields', () => {
    const rows = diffValues({ a: 1 }, { a: 1, b: 2 });
    const b = rows.find((r) => r.field === 'b');
    expect(b).toEqual({ field: 'b', label: 'b', before: '—', after: '2', changed: true });
  });
  it('includes unchanged fields flagged changed:false', () => {
    const rows = diffValues({ status: 'Active' }, { status: 'Active' });
    expect(rows).toEqual([
      { field: 'status', label: 'สถานะ', before: 'Active', after: 'Active', changed: false },
    ]);
  });
  it('returns [] when both sides are null/absent', () => {
    expect(diffValues(null, null)).toEqual([]);
    expect(diffValues(undefined, undefined)).toEqual([]);
  });
  it('sorts fields alphabetically for stable rendering', () => {
    const rows = diffValues({ b: 1, a: 1 }, { b: 2, a: 2 });
    expect(rows.map((r) => r.field)).toEqual(['a', 'b']);
  });
});
