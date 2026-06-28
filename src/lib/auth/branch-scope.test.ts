// src/lib/auth/branch-scope.test.ts
import { describe, expect, it, vi } from 'vitest';
import {
  employeeBranchScope,
  permittedBranchesFromAssignments,
  viaEmployeeBranchScope,
} from './branch-scope';
import type { AssignmentForCheck } from './check-permission';

const a = (branchId: string | null, perms: string[], isSuperadmin = false): AssignmentForCheck => ({
  branchId,
  role: { permissions: perms, isSuperadmin, archivedAt: null },
});

describe('permittedBranchesFromAssignments', () => {
  it("global grant → 'all'", () => {
    expect(
      permittedBranchesFromAssignments([a(null, ['attendance.read'])], 'attendance.read'),
    ).toBe('all');
  });
  it("isSuperadmin global → 'all'", () => {
    expect(permittedBranchesFromAssignments([a(null, [], true)], 'attendance.read')).toBe('all');
  });
  it('scoped grants → de-duped union', () => {
    const res = permittedBranchesFromAssignments(
      [a('b1', ['attendance.read']), a('b2', ['attendance.read']), a('b1', ['attendance.read'])],
      'attendance.read',
    );
    expect(res).toEqual(['b1', 'b2']);
  });
  it('no grant → []', () => {
    expect(permittedBranchesFromAssignments([a('b1', ['leave.read'])], 'attendance.read')).toEqual(
      [],
    );
  });
  it('archived role ignored', () => {
    const res = permittedBranchesFromAssignments(
      [
        {
          branchId: 'b1',
          role: { permissions: ['attendance.read'], isSuperadmin: false, archivedAt: new Date() },
        },
      ],
      'attendance.read',
    );
    expect(res).toEqual([]);
  });
});

describe('employeeBranchScope', () => {
  it("'all' → no filter", () => {
    expect(employeeBranchScope('all')).toEqual({});
  });
  it('scoped → home branch OR assignedBranchIds', () => {
    expect(employeeBranchScope(['b1', 'b2'])).toEqual({
      OR: [{ branchId: { in: ['b1', 'b2'] } }, { assignedBranchIds: { hasSome: ['b1', 'b2'] } }],
    });
  });
  it('empty → matches nothing', () => {
    expect(employeeBranchScope([])).toEqual({ id: { in: [] } });
  });
});

describe('viaEmployeeBranchScope', () => {
  it("'all' → {}", () => {
    expect(viaEmployeeBranchScope('all')).toEqual({});
  });
  it('scoped → { employee: {...} }', () => {
    expect(viaEmployeeBranchScope(['b1'])).toEqual({
      employee: { OR: [{ branchId: { in: ['b1'] } }, { assignedBranchIds: { hasSome: ['b1'] } }] },
    });
  });
});

describe('getPermittedBranches (wrapper)', () => {
  it('loads assignments then resolves', async () => {
    vi.resetModules();
    vi.doMock('./check-permission', () => ({
      getUserAssignments: vi.fn().mockResolvedValue([a('b1', ['attendance.read'])]),
    }));
    const { getPermittedBranches } = await import('./branch-scope');
    const res = await getPermittedBranches({ id: 'u1' }, 'attendance.read');
    expect(res).toEqual(['b1']);
    vi.doUnmock('./check-permission');
  });
});
