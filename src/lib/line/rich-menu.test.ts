import { describe, expect, it } from 'vitest';
import { computeMenuTarget, resolveCapabilities } from './rich-menu';

describe('computeMenuTarget', () => {
  it('admin + employee → combined', () => {
    expect(computeMenuTarget({ hasAdmin: true, hasEmployee: true })).toBe('combined');
  });
  it('admin only → admin', () => {
    expect(computeMenuTarget({ hasAdmin: true, hasEmployee: false })).toBe('admin');
  });
  it('employee only → none (OA default menu shows)', () => {
    expect(computeMenuTarget({ hasAdmin: false, hasEmployee: true })).toBe('none');
  });
  it('neither → none', () => {
    expect(computeMenuTarget({ hasAdmin: false, hasEmployee: false })).toBe('none');
  });
});

describe('resolveCapabilities', () => {
  const admin = { role: { key: 'admin', isSuperadmin: false, archivedAt: null } };
  const staff = { role: { key: 'staff', isSuperadmin: false, archivedAt: null } };
  const superadmin = { role: { key: 'owner', isSuperadmin: true, archivedAt: null } };

  it('employee who is also admin → both', () => {
    expect(resolveCapabilities({ employee: { id: 'e1' }, roleAssignments: [admin] })).toEqual({
      hasEmployee: true,
      hasAdmin: true,
    });
  });
  it('pure admin (no employee record) → admin only', () => {
    expect(resolveCapabilities({ employee: null, roleAssignments: [admin] })).toEqual({
      hasEmployee: false,
      hasAdmin: true,
    });
  });
  it('employee with only staff role → employee only', () => {
    expect(resolveCapabilities({ employee: { id: 'e1' }, roleAssignments: [staff] })).toEqual({
      hasEmployee: true,
      hasAdmin: false,
    });
  });
  it('superadmin counts as admin', () => {
    expect(resolveCapabilities({ employee: null, roleAssignments: [superadmin] })).toEqual({
      hasEmployee: false,
      hasAdmin: true,
    });
  });
  it('archived admin role does not count', () => {
    const archived = { role: { key: 'admin', isSuperadmin: false, archivedAt: new Date() } };
    expect(resolveCapabilities({ employee: { id: 'e1' }, roleAssignments: [archived] })).toEqual({
      hasEmployee: true,
      hasAdmin: false,
    });
  });
  it('no role assignments → neither capability', () => {
    expect(resolveCapabilities({ employee: null, roleAssignments: [] })).toEqual({
      hasEmployee: false,
      hasAdmin: false,
    });
  });
});
