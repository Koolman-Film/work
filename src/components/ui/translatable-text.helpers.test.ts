/**
 * Unit tests for the pure display helpers behind <TranslatableText>. The React
 * shell (loading spinner, click wiring) is verified by e2e/manual per repo
 * convention; the language naming + "already in the target language" decision
 * are the bits with real logic, so they live here as pure functions.
 */

import { describe, expect, it } from 'vitest';
import { isAlreadyTarget, languageNameTh } from './translatable-text.helpers';

describe('languageNameTh', () => {
  it('names the common source languages in Thai', () => {
    expect(languageNameTh('my')).toBe('พม่า');
    expect(languageNameTh('lo')).toBe('ลาว');
    expect(languageNameTh('km')).toBe('เขมร');
    expect(languageNameTh('en')).toBe('อังกฤษ');
  });

  it('is case-insensitive and ignores region subtags', () => {
    expect(languageNameTh('MY')).toBe('พม่า');
    expect(languageNameTh('zh-CN')).toBe('จีน');
  });

  it('falls back to the raw code for unknown languages', () => {
    expect(languageNameTh('xx')).toBe('xx');
    expect(languageNameTh('')).toBe('');
  });
});

describe('isAlreadyTarget', () => {
  it('is true when detected matches the target language', () => {
    expect(isAlreadyTarget('th', 'th')).toBe(true);
  });

  it('ignores case and region subtags', () => {
    expect(isAlreadyTarget('TH', 'th')).toBe(true);
    expect(isAlreadyTarget('th-TH', 'th')).toBe(true);
  });

  it('is false for a different source language', () => {
    expect(isAlreadyTarget('my', 'th')).toBe(false);
  });

  it('is false when detection is empty', () => {
    expect(isAlreadyTarget('', 'th')).toBe(false);
  });
});
