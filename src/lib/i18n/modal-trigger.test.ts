import { describe, expect, it } from 'vitest';
import { resolvePreselectLocale, shouldShowLanguageModal } from './modal-trigger';

describe('shouldShowLanguageModal', () => {
  it('shows the modal when the worker has never chosen', () => {
    expect(shouldShowLanguageModal(null)).toBe(true);
  });

  it('does NOT show the modal once the worker has chosen', () => {
    expect(shouldShowLanguageModal(new Date('2026-01-01T00:00:00Z'))).toBe(false);
  });
});

describe('resolvePreselectLocale', () => {
  it('prefers the admin default when set and supported', () => {
    expect(resolvePreselectLocale({ adminDefault: 'my', acceptLanguage: 'en-US' })).toBe('my');
  });

  it('falls back to Accept-Language when no admin default', () => {
    expect(resolvePreselectLocale({ adminDefault: null, acceptLanguage: 'km-KH' })).toBe('km');
  });

  it('ignores an unsupported admin default and uses Accept-Language', () => {
    expect(resolvePreselectLocale({ adminDefault: 'zz', acceptLanguage: 'lo' })).toBe('lo');
  });

  it('falls back to Thai when nothing matches', () => {
    expect(resolvePreselectLocale({ adminDefault: null, acceptLanguage: 'ja-JP' })).toBe('th');
    expect(resolvePreselectLocale({ adminDefault: null, acceptLanguage: null })).toBe('th');
  });
});
