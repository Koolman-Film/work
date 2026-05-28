/**
 * Tests for the pure tier-derivation policy.
 *
 * I/O-bearing `getUserTier` is trivially correct once `computeTier`
 * is; we only test the pure function.
 */

import { describe, expect, it } from 'vitest';
import { computeTier, type TierAssignment } from './user-tier';

function a(opts: {
  key?: string;
  isSuperadmin?: boolean;
  archivedAt?: Date | null;
}): TierAssignment {
  return {
    role: {
      key: opts.key ?? 'admin',
      isSuperadmin: opts.isSuperadmin ?? false,
      archivedAt: opts.archivedAt ?? null,
    },
  };
}

describe('computeTier', () => {
  it('returns null for no assignments', () => {
    expect(computeTier([])).toBeNull();
  });

  it('returns "Superadmin" for any isSuperadmin assignment (winning regardless of others)', () => {
    expect(computeTier([a({ isSuperadmin: true, key: 'superadmin' })])).toBe('Superadmin');
    // Even mixed with lower-tier assignments — Superadmin wins.
    expect(computeTier([a({ key: 'staff' }), a({ isSuperadmin: true, key: 'superadmin' })])).toBe(
      'Superadmin',
    );
  });

  it('returns "Admin" for the admin system role', () => {
    expect(computeTier([a({ key: 'admin' })])).toBe('Admin');
  });

  it('returns "Staff" for the staff system role', () => {
    expect(computeTier([a({ key: 'staff' })])).toBe('Staff');
  });

  it('Admin beats Staff when user holds both', () => {
    expect(computeTier([a({ key: 'staff' }), a({ key: 'admin' })])).toBe('Admin');
  });

  it('ignores archived role assignments', () => {
    // Archived admin → fall back to staff.
    expect(
      computeTier([a({ key: 'admin', archivedAt: new Date('2026-01-01') }), a({ key: 'staff' })]),
    ).toBe('Staff');
  });

  it('ignores archived Superadmin role (the user has been demoted)', () => {
    expect(
      computeTier([
        a({ key: 'superadmin', isSuperadmin: true, archivedAt: new Date('2026-01-01') }),
        a({ key: 'admin' }),
      ]),
    ).toBe('Admin');
  });

  it('returns null when all assignments are to archived roles', () => {
    expect(
      computeTier([
        a({ key: 'admin', archivedAt: new Date('2026-01-01') }),
        a({ key: 'staff', archivedAt: new Date('2026-01-01') }),
      ]),
    ).toBeNull();
  });

  it('custom (non-system) role assignments do NOT confer a tier', () => {
    // A customer-defined role with key 'finance-readonly' — even with
    // permissions — doesn't make the user "Admin" tier. Tier is the
    // system classification only; granular access goes through canDo.
    expect(computeTier([a({ key: 'finance-readonly' })])).toBeNull();
  });

  it('Superadmin shortcut works even on a custom role with isSuperadmin=true', () => {
    // Slightly unusual — a customer-defined "owner" role with
    // isSuperadmin=true. The shortcut fires regardless of key.
    expect(computeTier([a({ key: 'company-owner', isSuperadmin: true })])).toBe('Superadmin');
  });
});
