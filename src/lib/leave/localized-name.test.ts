import { describe, expect, it } from 'vitest';
import { asNameByLocale, localizedLeaveTypeName } from './localized-name';

describe('localizedLeaveTypeName', () => {
  it('picks the locale entry when present and non-blank', () => {
    const map = { en: 'Personal leave', my: 'ကိုယ်ရေးခွင့်' };
    expect(localizedLeaveTypeName('ลากิจ', map, 'en')).toBe('Personal leave');
    expect(localizedLeaveTypeName('ลากิจ', map, 'my')).toBe('ကိုယ်ရေးခွင့်');
  });

  it('falls back to the canonical name for missing/blank/invalid maps', () => {
    expect(localizedLeaveTypeName('ลากิจ', null, 'en')).toBe('ลากิจ');
    expect(localizedLeaveTypeName('ลากิจ', undefined, 'en')).toBe('ลากิจ');
    expect(localizedLeaveTypeName('ลากิจ', {}, 'en')).toBe('ลากิจ');
    expect(localizedLeaveTypeName('ลากิจ', { en: '   ' }, 'en')).toBe('ลากิจ');
    expect(localizedLeaveTypeName('ลากิจ', { en: 42 }, 'en')).toBe('ลากิจ');
    expect(localizedLeaveTypeName('ลากิจ', ['en'], 'en')).toBe('ลากิจ');
    expect(localizedLeaveTypeName('ลากิจ', 'en', 'en')).toBe('ลากิจ');
  });

  it('trims the localized value', () => {
    expect(localizedLeaveTypeName('ลากิจ', { en: '  Sick leave ' }, 'en')).toBe('Sick leave');
  });
});

describe('asNameByLocale', () => {
  it('narrows a valid map and drops non-string values', () => {
    expect(asNameByLocale({ en: 'A', my: 7, lo: 'B' })).toEqual({ en: 'A', lo: 'B' });
  });

  it('returns null for null/arrays/scalars/empty maps', () => {
    expect(asNameByLocale(null)).toBeNull();
    expect(asNameByLocale(undefined)).toBeNull();
    expect(asNameByLocale([])).toBeNull();
    expect(asNameByLocale('x')).toBeNull();
    expect(asNameByLocale({})).toBeNull();
    expect(asNameByLocale({ en: 1 })).toBeNull();
  });
});
