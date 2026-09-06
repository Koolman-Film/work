import { describe, expect, it } from 'vitest';
import { isTheme, resolveThemeAttrs, THEME_COOKIE_NAME } from './config';

describe('isTheme', () => {
  it('accepts the three supported values', () => {
    expect(isTheme('light')).toBe(true);
    expect(isTheme('dark')).toBe(true);
    expect(isTheme('system')).toBe(true);
  });

  it('rejects anything else', () => {
    for (const v of ['Light', 'DARK', '', null, undefined, 7, {}]) {
      expect(isTheme(v)).toBe(false);
    }
  });
});

describe('resolveThemeAttrs', () => {
  it('stamps nothing for system, so prefers-color-scheme decides', () => {
    // The no-flash property lives here. With no explicit choice we emit NO
    // data-theme and let the media query resolve before first paint.
    // Stamping "light" would break every visitor on a dark OS.
    expect(resolveThemeAttrs('system')).toEqual({
      dataTheme: undefined,
      colorScheme: 'light dark',
    });
  });

  it('treats a missing or unrecognised cookie as system', () => {
    expect(resolveThemeAttrs(null)).toEqual({ dataTheme: undefined, colorScheme: 'light dark' });
    expect(resolveThemeAttrs(undefined)).toEqual({
      dataTheme: undefined,
      colorScheme: 'light dark',
    });
    expect(resolveThemeAttrs('purple')).toEqual({
      dataTheme: undefined,
      colorScheme: 'light dark',
    });
  });

  it('stamps an explicit choice', () => {
    expect(resolveThemeAttrs('dark')).toEqual({ dataTheme: 'dark', colorScheme: 'dark' });
    expect(resolveThemeAttrs('light')).toEqual({ dataTheme: 'light', colorScheme: 'light' });
  });
});

describe('cookie name', () => {
  it('does not collide with the locale cookie', () => {
    expect(THEME_COOKIE_NAME).not.toBe('NEXT_LOCALE');
  });
});
