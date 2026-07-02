import { describe, expect, it } from 'vitest';
import { localizedBranchName } from './localized-name';

describe('localizedBranchName', () => {
  const branch = { name: 'เชียงใหม่', nameEn: 'Chiang Mai' };

  it('returns the native name for the Thai locale', () => {
    expect(localizedBranchName(branch, 'th')).toBe('เชียงใหม่');
  });

  it('returns the English name for a non-Thai locale', () => {
    expect(localizedBranchName(branch, 'en')).toBe('Chiang Mai');
    expect(localizedBranchName(branch, 'my')).toBe('Chiang Mai');
  });

  it('falls back to the native name when nameEn is null, even for non-Thai', () => {
    expect(localizedBranchName({ name: 'เชียงใหม่', nameEn: null }, 'en')).toBe('เชียงใหม่');
  });
});
