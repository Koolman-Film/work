import { describe, expect, it } from 'vitest';
import { memberIdentity, memberSortKey } from './member-label';

describe('memberIdentity', () => {
  it('email-invited admin → shows the email', () => {
    expect(memberIdentity({ email: 'admin-2@example.invalid', employee: null })).toEqual({
      kind: 'email',
      label: 'admin-2@example.invalid',
    });
  });

  it('email wins even when an employee is also linked', () => {
    expect(
      memberIdentity({
        email: 'a@b.com',
        employee: { nickname: 'EMP-D', firstName: 'ไพริน', lastName: 'EMP-B' },
      }),
    ).toEqual({ kind: 'email', label: 'a@b.com' });
  });

  it('LINE employee-admin (no email) → "nickname · full name"', () => {
    expect(
      memberIdentity({
        email: null,
        employee: { nickname: 'EMP-D', firstName: 'ไพริน', lastName: 'EMP-B' },
      }),
    ).toEqual({ kind: 'line', label: 'EMP-D · ไพริน EMP-B' });
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
        employee: { nickname: 'EMP-D', firstName: 'ไพริน', lastName: 'EMP-B' },
      }),
    ).toBe('EMP-D · ไพริน EMP-B');
  });

  it('empty string for unknown so it sorts first', () => {
    expect(memberSortKey({ email: null, employee: null })).toBe('');
  });
});
