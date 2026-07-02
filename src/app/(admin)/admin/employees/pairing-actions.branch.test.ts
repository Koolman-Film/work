/**
 * Integration tests: branch-scope act-on gating for pairing-link mutations.
 *
 * Strategy: mock every boundary (next/navigation, next/cache, auth, prisma,
 * audit, pairing/token) — then call the REAL functions and assert gate +
 * mutation behaviour for generatePairingLink / revokePairingLink.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── next/* mocks ─────────────────────────────────────────────────────────────
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  redirect: (u: string) => {
    throw new Error(`REDIRECT:${u}`);
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

// ── audit mock ───────────────────────────────────────────────────────────────
vi.mock('@/lib/audit/log', () => ({ auditLog: vi.fn() }));

// ── auth mocks ───────────────────────────────────────────────────────────────
const requirePermission = vi.fn();
const getUserAssignments = vi.fn();

vi.mock('@/lib/auth/check-permission', () => ({
  requirePermission: (...a: unknown[]) => requirePermission(...a),
  getUserAssignments: (...a: unknown[]) => getUserAssignments(...a),
  canDo: vi.fn(),
}));

// ── prisma mocks ─────────────────────────────────────────────────────────────
const empFindUnique = vi.fn();
const empUpdate = vi.fn();

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    employee: {
      findUnique: (...a: unknown[]) => empFindUnique(...a),
      update: (...a: unknown[]) => empUpdate(...a),
    },
  },
}));

// ── pairing token mock ───────────────────────────────────────────────────────
vi.mock('@/lib/pairing/token', () => ({
  mintPairingToken: vi.fn().mockResolvedValue({
    token: 'tok-abc',
    expiresAt: new Date('2099-01-01'),
  }),
}));

import { generatePairingLink, revokePairingLink } from './pairing-actions';

// ── helpers ───────────────────────────────────────────────────────────────────

function scopedAssignments(branchId: string, perm: string) {
  return [
    {
      branchId,
      role: { permissions: [perm], isSuperadmin: false, archivedAt: null },
    },
  ];
}

function globalAssignments(perm: string) {
  return [
    {
      branchId: null,
      role: { permissions: [perm], isSuperadmin: false, archivedAt: null },
    },
  ];
}

/** Minimal row for generatePairingLink. No lineUserId so we pass the early checks. */
function generateEmpRow(branchId: string, assignedBranchIds: string[]) {
  return {
    id: 'e1',
    archivedAt: null,
    branchId,
    assignedBranchIds,
    user: { authUserId: null, lineUserId: null },
  };
}

/** Minimal row for revokePairingLink. Has inviteToken so we pass the early check. */
function revokeEmpRow(branchId: string, assignedBranchIds: string[]) {
  return {
    inviteToken: 'existing-token',
    branchId,
    assignedBranchIds,
  };
}

// ─── generatePairingLink ──────────────────────────────────────────────────────

describe('generatePairingLink — branch act-on gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({ user: { id: 'actor' } });
    empUpdate.mockResolvedValue({});
  });

  it('denies a scoped actor (A) acting on an employee home=B assigned=[] — no mutation', async () => {
    getUserAssignments.mockResolvedValue(scopedAssignments('branch-A', 'employee.update'));
    empFindUnique.mockResolvedValue(generateEmpRow('branch-B', []));

    await expect(generatePairingLink('e1')).rejects.toThrow('NOT_FOUND');
    expect(empUpdate).not.toHaveBeenCalled();
  });

  it('allows a scoped actor (A) on a rotating employee home=B assigned=[A]', async () => {
    getUserAssignments.mockResolvedValue(scopedAssignments('branch-A', 'employee.update'));
    empFindUnique.mockResolvedValue(generateEmpRow('branch-B', ['branch-A']));

    await generatePairingLink('e1').catch(() => {});
    expect(empUpdate).toHaveBeenCalled();
  });

  it('allows a global actor on any employee', async () => {
    getUserAssignments.mockResolvedValue(globalAssignments('employee.update'));
    empFindUnique.mockResolvedValue(generateEmpRow('branch-Z', []));

    await generatePairingLink('e1').catch(() => {});
    expect(empUpdate).toHaveBeenCalled();
  });
});

// ─── revokePairingLink ────────────────────────────────────────────────────────

describe('revokePairingLink — branch act-on gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({ user: { id: 'actor' } });
    empUpdate.mockResolvedValue({});
  });

  it('denies a scoped actor (A) acting on an employee home=B assigned=[] — no mutation', async () => {
    getUserAssignments.mockResolvedValue(scopedAssignments('branch-A', 'employee.update'));
    empFindUnique.mockResolvedValue(revokeEmpRow('branch-B', []));

    await expect(revokePairingLink('e1')).rejects.toThrow('NOT_FOUND');
    expect(empUpdate).not.toHaveBeenCalled();
  });

  it('allows a scoped actor (A) on a rotating employee home=B assigned=[A]', async () => {
    getUserAssignments.mockResolvedValue(scopedAssignments('branch-A', 'employee.update'));
    empFindUnique.mockResolvedValue(revokeEmpRow('branch-B', ['branch-A']));

    await revokePairingLink('e1').catch(() => {});
    expect(empUpdate).toHaveBeenCalled();
  });

  it('allows a global actor on any employee', async () => {
    getUserAssignments.mockResolvedValue(globalAssignments('employee.update'));
    empFindUnique.mockResolvedValue(revokeEmpRow('branch-Z', []));

    await revokePairingLink('e1').catch(() => {});
    expect(empUpdate).toHaveBeenCalled();
  });
});
