import { describe, expect, it } from 'vitest';
import { monthUrl, rangeUrl } from './period-url';

describe('monthUrl', () => {
  it('builds a month-mode URL', () => {
    expect(monthUrl('2026-06')).toBe('/liff/summary?m=2026-06');
  });
});

describe('rangeUrl', () => {
  it('builds a custom-range URL', () => {
    expect(rangeUrl('2026-06-01', '2026-06-15')).toBe(
      '/liff/summary?from=2026-06-01&to=2026-06-15',
    );
  });

  it('returns the month URL when either bound is missing', () => {
    expect(rangeUrl('', '2026-06-15')).toBeNull();
    expect(rangeUrl('2026-06-01', '')).toBeNull();
  });

  it('returns null for an inverted range rather than a URL the server will discard', () => {
    expect(rangeUrl('2026-06-20', '2026-06-01')).toBeNull();
  });
});
