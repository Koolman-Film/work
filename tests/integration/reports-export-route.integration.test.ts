/**
 * Integration test: the report EXPORT ROUTE enforces branch-scope.
 *
 * GET /admin/reports/[report]/export reuses the page query layer, which was
 * refactored (Spec B5) to take a `permitted` branch scope. The route was
 * merged from an older branch that called the queries WITHOUT `permitted`;
 * the merge resolution re-wired it to fetch getPermittedBranches(user,
 * 'report.read') and thread it through. This test pins that wiring: a
 * branch-scoped caller's export must contain ONLY their permitted branches —
 * a leak here would ship every branch's payroll-adjacent data in a file.
 *
 * We assert on CSV (deterministic, no chromium/exceljs needed). The first
 * column is the employee display name, so branch-scoping is visible directly.
 *
 * Mocks:
 *   - `@/lib/auth/check-permission` → requirePermission (session bypass) and
 *     getUserAssignments (getPermittedBranches reads it). The assignment set
 *     is swapped per-test via `scopeHolder` to simulate a global vs
 *     single-branch admin. branch-scope.ts itself stays REAL so the query's
 *     employeeBranchScope filter is exercised for real.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db/prisma';

const adminUserHolder = { id: '00000000-0000-0000-0000-000000000000' };

// Per-test scope: assignments that permittedBranchesFromAssignments(…, 'report.read')
// collapses into either 'all' (superadmin) or a single-branch list.
type Assignment = {
  branchId: string | null;
  role: {
    id: string;
    key: string;
    name: string;
    permissions: string[];
    isSuperadmin: boolean;
    archivedAt: Date | null;
  };
};
const scopeHolder: { assignments: Assignment[] } = { assignments: [] };

function branchScopedAssignment(branchId: string): Assignment {
  return {
    branchId,
    role: {
      id: 'test-report-reader',
      key: 'report-reader',
      name: 'Report Reader',
      permissions: ['report.read'],
      isSuperadmin: false,
      archivedAt: null,
    },
  };
}
function globalAssignment(): Assignment {
  return {
    branchId: null,
    role: {
      id: 'test-superadmin',
      key: 'superadmin',
      name: 'Superadmin',
      permissions: [],
      isSuperadmin: true,
      archivedAt: null,
    },
  };
}

vi.mock('@/lib/auth/check-permission', () => ({
  requirePermission: vi.fn(async () => ({
    user: adminUserHolder,
    authUserId: adminUserHolder.id,
    tier: 'Admin',
  })),
  getUserAssignments: vi.fn(async () => scopeHolder.assignments),
}));

// Import AFTER vi.mock hoisting.
import { GET } from '@/app/(admin)/admin/reports/[report]/export/route';

// ── DB reset (FK-safe; shared DB) ─────────────────────────────────────────────
async function reset() {
  await prisma.auditLog.deleteMany({});
  await prisma.payrollAdjustment.deleteMany({});
  await prisma.payroll.deleteMany({});
  await prisma.recurringDeduction.deleteMany({});
  await prisma.overtimeEntry.deleteMany({});
  await prisma.attendance.deleteMany({});
  await prisma.cashAdvance.deleteMany({});
  await prisma.leaveRequest.deleteMany({});
  await prisma.leaveEntitlement.deleteMany({});
  await prisma.employee.deleteMany({});
  await prisma.userRoleAssignment.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.branch.deleteMany({});
}

beforeEach(reset);
afterAll(async () => {
  await prisma.$disconnect();
});

// Unique names per run so assertions can't collide with any stray rows.
const IN_NAME = `ExpScopedIn${crypto.randomUUID().slice(0, 8)}`;
const OUT_NAME = `ExpScopedOut${crypto.randomUUID().slice(0, 8)}`;

async function makeEmployee(firstName: string, branchId: string) {
  const user = await prisma.user.create({ data: {} });
  return prisma.employee.create({
    data: {
      userId: user.id,
      firstName,
      lastName: 'W',
      branchId,
      salaryType: 'Monthly',
      baseSalary: 20000,
      status: 'Active',
      hiredAt: new Date('2026-01-01'),
    },
  });
}

/** Seed two branches with one employee each; return the in-scope branch id. */
async function seedTwoBranches() {
  const adminUser = await prisma.user.create({ data: {} });
  adminUserHolder.id = adminUser.id;
  const b1 = await prisma.branch.create({
    data: { name: `B1-${crypto.randomUUID().slice(0, 8)}` },
  });
  const b2 = await prisma.branch.create({
    data: { name: `B2-${crypto.randomUUID().slice(0, 8)}` },
  });
  await makeEmployee(IN_NAME, b1.id);
  await makeEmployee(OUT_NAME, b2.id);
  return b1.id;
}

function callExport(report: string, query: string) {
  const url = new URL(`http://x/admin/reports/${report}/export?${query}`);
  // The route only touches req.nextUrl.searchParams — a URL shim is enough.
  return GET({ nextUrl: url } as never, { params: Promise.resolve({ report }) });
}

const PERIOD_Q = 'format=csv&from=2026-06-01&to=2026-06-30';

describe('report export route — branch scope', () => {
  it('a branch-scoped admin gets ONLY their branch (out-of-scope rows excluded)', async () => {
    const b1 = await seedTwoBranches();
    scopeHolder.assignments = [branchScopedAssignment(b1)];

    const res = await callExport('attendance', PERIOD_Q);
    expect(res.status).toBe(200);
    const csv = await res.text();

    expect(csv).toContain(IN_NAME); // in-scope branch present
    expect(csv).not.toContain(OUT_NAME); // other branch NOT leaked
  });

  it('a global admin exports every branch', async () => {
    await seedTwoBranches();
    scopeHolder.assignments = [globalAssignment()];

    const res = await callExport('attendance', PERIOD_Q);
    expect(res.status).toBe(200);
    const csv = await res.text();

    expect(csv).toContain(IN_NAME);
    expect(csv).toContain(OUT_NAME);
  });

  it('an admin with no report.read grant exports nothing (empty scope, not everything)', async () => {
    await seedTwoBranches();
    scopeHolder.assignments = []; // permitted = [] → no branches

    const res = await callExport('attendance', PERIOD_Q);
    expect(res.status).toBe(200);
    const csv = await res.text();

    expect(csv).not.toContain(IN_NAME);
    expect(csv).not.toContain(OUT_NAME);
  });

  it('rejects an unknown export format with 400 (no query runs)', async () => {
    const b1 = await seedTwoBranches();
    scopeHolder.assignments = [branchScopedAssignment(b1)];

    const res = await callExport('attendance', 'format=exe');
    expect(res.status).toBe(400);
  });
});
