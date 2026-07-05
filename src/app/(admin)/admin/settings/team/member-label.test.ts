import { describe, expect, it } from 'vitest';
import { memberIdentity, memberSortKey } from './member-label';

describe('memberIdentity', () => {
  it('email-invited admin → shows the email', () => {
    expect(memberIdentity({ email: 'acc01.koolman@gmail.com', employee: null })).toEqual({
      kind: 'email',
      label: 'acc01.koolman@gmail.com',
    });
  });

  it('email wins even when an employee is also linked', () => {
    expect(
      memberIdentity({
        email: 'a@b.com',
        employee: { nickname: 'ฝ้าย', firstName: 'ไพริน', lastName: 'บุญเป็ง' },
      }),
    ).toEqual({ kind: 'email', label: 'a@b.com' });
  });

  it('LINE employee-admin (no email) → "nickname · full name"', () => {
    expect(
      memberIdentity({
        email: null,
        employee: { nickname: 'ฝ้าย', firstName: 'ไพริน', lastName: 'บุญเป็ง' },
      }),
    ).toEqual({ kind: 'line', label: 'ฝ้าย · ไพริน บุญเป็ง' });
  });

  it('no nickname → full name only', () => {
    expect(
      memberIdentity({
        email: null,
        employee: { nickname: null, firstName: 'ธนพัฒ', lastName: 'กมลทิพย์วงศ์' },
      }),
    ).toEqual({ kind: 'line', label: 'ธนพัฒ กมลทิพย์วงศ์' });
  });

  it('nickname but empty name → nickname only', () => {
    expect(
      memberIdentity({ email: null, employee: { nickname: 'ต๋อง', firstName: '', lastName: '' } }),
    ).toEqual({ kind: 'line', label: 'ต๋อง' });
  });

  it('blank/whitespace email is treated as no email', () => {
    expect(
      memberIdentity({
        email: '   ',
        employee: { nickname: 'ต๋อง', firstName: 'tong', lastName: 'test' },
      }),
    ).toEqual({ kind: 'line', label: 'ต๋อง · tong test' });
  });

  it('no email and no employee → unknown', () => {
    expect(memberIdentity({ email: null, employee: null })).toEqual({ kind: 'unknown' });
  });

  it('no email, employee with all-blank fields → unknown (nothing to show)', () => {
    expect(
      memberIdentity({ email: null, employee: { nickname: '  ', firstName: '', lastName: '' } }),
    ).toEqual({ kind: 'unknown' });
  });
});

describe('memberSortKey', () => {
  it('uses email when present', () => {
    expect(memberSortKey({ email: 'z@b.com', employee: null })).toBe('z@b.com');
  });

  it('uses the display label for emailless rows', () => {
    expect(
      memberSortKey({
        email: null,
        employee: { nickname: 'ฝ้าย', firstName: 'ไพริน', lastName: 'บุญเป็ง' },
      }),
    ).toBe('ฝ้าย · ไพริน บุญเป็ง');
  });

  it('empty string for unknown so it sorts first', () => {
    expect(memberSortKey({ email: null, employee: null })).toBe('');
  });
});
