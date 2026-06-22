import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatMoney,
  formatMonthYear,
  formatNumber,
  formatShortDate,
  formatTime,
} from './format';

// Mid-day UTC so the Asia/Bangkok (UTC+7) calendar date never rolls over.
const may30 = new Date(Date.UTC(2026, 4, 30, 5, 0, 0));

describe('formatDate', () => {
  it('Thai: swaps the Gregorian year for the Buddhist year (CE+543)', () => {
    const out = formatDate(may30, 'th');
    expect(out).toContain('พฤษภาคม');
    expect(out).toContain('30');
    expect(out).toContain('2569');
    expect(out).not.toContain('2026');
  });
  it('English: native long date', () => {
    expect(formatDate(may30, 'en')).toBe('May 30, 2026');
  });
});

describe('formatShortDate', () => {
  it('Thai short date uses the Buddhist year', () => {
    const out = formatShortDate(may30, 'th');
    expect(out).toContain('2569');
    expect(out).not.toContain('2026');
  });
  it('English short date is dd/mm/yyyy-ish with the CE year', () => {
    expect(formatShortDate(may30, 'en')).toContain('2026');
  });
});

describe('formatMonthYear', () => {
  it('formats a YYYY-MM pay period (Thai BE / English)', () => {
    expect(formatMonthYear('2026-05', 'th')).toContain('2569');
    expect(formatMonthYear('2026-05', 'th')).toContain('พฤษภาคม');
    expect(formatMonthYear('2026-05', 'en')).toBe('May 2026');
  });
  it('returns the raw string for unparseable input', () => {
    expect(formatMonthYear('nope', 'en')).toBe('nope');
  });
});

describe('formatTime', () => {
  it('renders 24-hour Bangkok time', () => {
    // 07:30 UTC = 14:30 Asia/Bangkok.
    expect(formatTime(new Date(Date.UTC(2026, 4, 30, 7, 30)), 'th')).toBe('14:30');
  });
});

describe('formatMoney', () => {
  it('always prefixes ฿ and shows 2 decimals', () => {
    expect(formatMoney(1234.5, 'en')).toBe('฿1,234.50');
    expect(formatMoney('1000', 'en')).toBe('฿1,000.00');
  });
  it('rounds to 2 decimals', () => {
    expect(formatMoney('1234.567', 'en')).toBe('฿1,234.57');
  });
  it('renders ฿— for non-finite input', () => {
    expect(formatMoney('abc', 'en')).toBe('฿—');
    expect(formatMoney(Number.NaN, 'en')).toBe('฿—');
  });
});

describe('formatNumber', () => {
  it('adds locale thousand separators', () => {
    expect(formatNumber(1234567, 'en')).toBe('1,234,567');
  });
});
