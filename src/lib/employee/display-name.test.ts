import { describe, expect, it } from 'vitest';
import { employeeDisplayName } from './display-name';

describe('employeeDisplayName', () => {
  it('prefers the nickname when it has content', () => {
    expect(employeeDisplayName({ firstName: 'EMP-A', lastName: 'ทองดี', nickname: 'EMP-A' })).toBe('EMP-A');
  });

  it('falls back to first + last when the nickname is blank', () => {
    expect(employeeDisplayName({ firstName: 'EMP-B', lastName: 'EMP-B', nickname: '   ' })).toBe(
      'EMP-B',
    );
  });

  it('falls back when the nickname is null', () => {
    expect(employeeDisplayName({ firstName: 'พี่', lastName: 'แดง', nickname: null })).toBe('EMP-C');
  });

  it('trims a padded nickname rather than returning the padding', () => {
    expect(employeeDisplayName({ firstName: 'ก', lastName: 'ข', nickname: '  ตุ่น  ' })).toBe('ตุ่น');
  });

  it('trims the fallback when a name part is empty', () => {
    expect(employeeDisplayName({ firstName: 'ตุ่น', lastName: '', nickname: null })).toBe('ตุ่น');
  });
});
