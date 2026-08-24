import { describe, expect, it } from 'vitest';
import { employeeDisplayName } from './display-name';

// Fixtures are deliberately fictional. Real employee names must never appear in
// committed code — this repository is public, and a name in a test fixture is
// just as exposed as one in a document.

describe('employeeDisplayName', () => {
  it('prefers the nickname when it has content', () => {
    expect(employeeDisplayName({ firstName: 'สมชาย', lastName: 'ใจดี', nickname: 'ชาย' })).toBe(
      'ชาย',
    );
  });

  it('falls back to first + last when the nickname is blank', () => {
    expect(employeeDisplayName({ firstName: 'สมหญิง', lastName: 'รักงาน', nickname: '   ' })).toBe(
      'สมหญิง รักงาน',
    );
  });

  it('falls back when the nickname is null', () => {
    expect(employeeDisplayName({ firstName: 'มานี', lastName: 'มานะ', nickname: null })).toBe(
      'มานี มานะ',
    );
  });

  it('trims a padded nickname rather than returning the padding', () => {
    expect(employeeDisplayName({ firstName: 'ก', lastName: 'ข', nickname: '  ตุ๊กตา  ' })).toBe(
      'ตุ๊กตา',
    );
  });

  it('trims the fallback when a name part is empty', () => {
    expect(employeeDisplayName({ firstName: 'ปิติ', lastName: '', nickname: null })).toBe('ปิติ');
  });
});
