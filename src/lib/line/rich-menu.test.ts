import { describe, expect, it } from 'vitest';
import { computeMenuTarget, resolveCapabilities } from './rich-menu';

describe('computeMenuTarget', () => {
  it('admin + employee → combined', () => {
    expect(computeMenuTarget({ hasAdmin: true, hasEmployee: true })).toBe('combined');
  });
  it('admin only → admin', () => {
    expect(computeMenuTarget({ hasAdmin: true, hasEmployee: false })).toBe('admin');
  });
  it('employee only → employee (all-dynamic: no OA default menu)', () => {
    expect(computeMenuTarget({ hasAdmin: false, hasEmployee: true })).toBe('employee');
  });
  it('neither → none (blank menu bar)', () => {
    expect(computeMenuTarget({ hasAdmin: false, hasEmployee: false })).toBe('none');
  });
});

describe('resolveCapabilities', () => {
  const admin = { role: { key: 'admin', isSuperadmin: false, archivedAt: null } };
  const staff = { role: { key: 'staff', isSuperadmin: false, archivedAt: null } };
  const superadmin = { role: { key: 'owner', isSuperadmin: true, archivedAt: null } };
  const activeEmp = { archivedAt: null };

  it('employee who is also admin → both', () => {
    expect(
      resolveCapabilities({ archivedAt: null, employee: activeEmp, roleAssignments: [admin] }),
    ).toEqual({ hasEmployee: true, hasAdmin: true });
  });
  it('pure admin (no employee record) → admin only', () => {
    expect(
      resolveCapabilities({ archivedAt: null, employee: null, roleAssignments: [admin] }),
    ).toEqual({ hasEmployee: false, hasAdmin: true });
  });
  it('employee with only staff role → employee only', () => {
    expect(
      resolveCapabilities({ archivedAt: null, employee: activeEmp, roleAssignments: [staff] }),
    ).toEqual({ hasEmployee: true, hasAdmin: false });
  });
  it('superadmin counts as admin', () => {
    expect(
      resolveCapabilities({ archivedAt: null, employee: null, roleAssignments: [superadmin] }),
    ).toEqual({ hasEmployee: false, hasAdmin: true });
  });
  it('archived admin role does not count', () => {
    const archivedRole = { role: { key: 'admin', isSuperadmin: false, archivedAt: new Date() } };
    expect(
      resolveCapabilities({
        archivedAt: null,
        employee: activeEmp,
        roleAssignments: [archivedRole],
      }),
    ).toEqual({ hasEmployee: true, hasAdmin: false });
  });
  it('no role assignments → neither capability', () => {
    expect(resolveCapabilities({ archivedAt: null, employee: null, roleAssignments: [] })).toEqual({
      hasEmployee: false,
      hasAdmin: false,
    });
  });
  it('archived User → no capabilities (menu unlinks, even with roles)', () => {
    expect(
      resolveCapabilities({
        archivedAt: new Date(),
        employee: activeEmp,
        roleAssignments: [admin],
      }),
    ).toEqual({ hasEmployee: false, hasAdmin: false });
  });
  it('archived Employee → no employee capability (admin still counts)', () => {
    expect(
      resolveCapabilities({
        archivedAt: null,
        employee: { archivedAt: new Date() },
        roleAssignments: [admin],
      }),
    ).toEqual({ hasEmployee: false, hasAdmin: true });
  });
  it('archived Employee, staff only → neither (blank menu)', () => {
    expect(
      resolveCapabilities({
        archivedAt: null,
        employee: { archivedAt: new Date() },
        roleAssignments: [staff],
      }),
    ).toEqual({ hasEmployee: false, hasAdmin: false });
  });
});
