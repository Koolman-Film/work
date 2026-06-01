import { describe, expect, it } from 'vitest';
import { formatTHB, formatThaiDate, initials } from './format';

describe('formatTHB', () => {
  it('formats with ฿ and thousands separators, no decimals', () => {
    expect(formatTHB(5000)).toBe('฿5,000');
    expect(formatTHB(0)).toBe('฿0');
    expect(formatTHB(1234567)).toBe('฿1,234,567');
  });

  it('rounds away fractional baht', () => {
    expect(formatTHB(99.7)).toBe('฿100');
  });
});

describe('initials', () => {
  it('takes the first two characters, uppercased', () => {
    expect(initials('สมพงษ์ ผจญภัย')).toBe('สม');
    expect(initials('admin@x.com')).toBe('AD');
  });

  it('trims leading whitespace first', () => {
    expect(initials('  nok')).toBe('NO');
  });
});

describe('formatThaiDate', () => {
  it('renders a short Thai month', () => {
    expect(formatThaiDate(new Date('2026-06-01T00:00:00+07:00'))).toMatch(/มิ\.ย\./);
  });
});
