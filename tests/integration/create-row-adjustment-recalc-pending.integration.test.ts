/**
 * Integration test for Defect 3: `createRowAdjustment`/`deleteRowAdjustment`
 * (admin/payroll/actions.ts) must never let a failed courtesy recalculation
 * turn an already-committed write into a reported failure.
 *
 * Before this fix, `createRowAdjustment` created the PayrollAdjustment row,
 * wrote its audit entry, then called `await runPayrollDraft(month)`
 * UNGUARDED. A throw there (now materially more likely — the lock this
 * branch adds contention around, month-lock.ts) rejected the whole server
 * action: the adjustment was already committed, but the admin saw a crashed
 * page and, not knowing the write had succeeded, would resubmit the same
 * form — creating a SECOND adjustment for the same reason/amount. This test
 * proves the fix: the first call alone completes cleanly (redirects with a
 * "recalculation pending" message, not a thrown rejection), and exactly one
 * row exists — there is no thrown error to prompt a resubmit in the first
 * place. `deleteRowAdjustment` has the same shape but returns an
 * `ActionResult` for `ConfirmDialog` (confirm-dialog.tsx), which has no
 * try/catch around `action()` — an uncaught rejection there crashes the
 * transition instead of reporting the completed delete as `{ ok: true }`.
 *
 * `runPayrollDraft` is partially mocked (import-actual + override) so this
 * test can force exactly the recalculation-step failure without touching the
 * adjustment-writing path at all — mirrors
 * reconcile-settle-recalc-pending.integration.test.ts's identical pattern
 * for the settlement actions.
 *
 * Mocks required because `createRowAdjustment`/`deleteRowAdjustment` are
 * Next.js Server Actions:
 *   - `@/lib/auth/check-permission` → requirePermission / getUserAssignments:
 *     bypasses Supabase session; stubs a superadmin (global) grant so
 *     `requireGlobalPermission('payroll.run')` passes.
 *   - `next/cache` → revalidatePath: no-op; there is no Next.js cache here.
 *   - `next/navigation` → redirect: throws a distinguishable error carrying
 *     the target URL instead of actually redirecting (there is no Next.js
 *     request context in a plain vitest run) — `createRowAdjustment` always
 *     ends in `back()` → `redirect()`, success included.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db/prisma';

const adminUserHolder: { id: string } = { id: '00000000-0000-0000-0000-000000000000' };

vi.mock('@/lib/auth/check-permission', () => ({
  requirePermission: vi.fn(async () => ({
    user: adminUserHolder,
    authUserId: adminUserHolder.id,
    tier: 'Admin',
  })),
  getUserAssignments: vi.fn(async () => [
    {
      branchId: null,
      role: {
        id: 'test-superadmin',
        key: 'superadmin',
        name: 'Superadmin',
        permissions: [],
        isSuperadmin: true,
        archivedAt: null,
      },
    },
  ]),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

// `vi.mock` factories are hoisted to the top of the file — `runPayrollDraftMock`
// must be created through `vi.hoisted` so it exists by the time the factory
// below runs, rather than as a plain top-level `const` (which would still be
// in its TDZ at that point).
const { runPayrollDraftMock } = vi.hoisted(() => ({ runPayrollDraftMock: vi.fn() }));
vi.mock('@/lib/payroll/run', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/payroll/run')>();
  // Default: delegate to the REAL implementation, so any test that doesn't
  // explicitly override this (via `.mockRejectedValueOnce`) behaves exactly
  // like production. Set once here (not in beforeEach) so per-test overrides
  // fall back to this afterward instead of to a cleared no-op.
  runPayrollDraftMock.mockImplementation((month: string) => actual.runPayrollDraft(month));
  return { ...actual, runPayrollDraft: runPayrollDraftMock };
});

import { Prisma } from '@prisma/client';
// Import AFTER vi.mock hoisting.
import { createRowAdjustment, deleteRowAdjustment } from '@/app/(admin)/admin/payroll/actions';

function uid(): string {
  return crypto.randomUUID();
}

async function reset() {
  await prisma.payrollAdjustment.deleteMany({});
  await prisma.payroll.deleteMany({});
  await prisma.employee.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.branch.deleteMany({});
  await prisma.payrollConfig.deleteMany({});
  await prisma.leaveConfig.deleteMany({});

  await prisma.payrollConfig.create({
    data: {
      ssoRate: new Prisma.Decimal('0.05'),
      ssoSalaryCap: new Prisma.Decimal(15_000),
      ssoAmountCap: new Prisma.Decimal(750),
      otMultiplier: new Prisma.Decimal('1.5'),
      absentDeductionPerDay: new Prisma.Decimal(500),
      lateDeduction: new Prisma.Decimal(100),
      earlyLeaveDeduction: new Prisma.Decimal(100),
    },
  });
  await prisma.leaveConfig.create({ data: {} });

  const adminUser = await prisma.user.create({ data: {} });
  adminUserHolder.id = adminUser.id;

  // Clear call history only — keep the default real-implementation fallback
  // set up in the vi.mock factory above.
  runPayrollDraftMock.mockClear();
}

async function makeEmployee() {
  const user = await prisma.user.create({ data: {} });
  const branch = await prisma.branch.create({ data: { name: `Branch-${uid().slice(0, 8)}` } });
  return prisma.employee.create({
    data: {
      userId: user.id,
      firstName: 'Test',
      lastName: 'Worker',
      branchId: branch.id,
      salaryType: 'Monthly',
      baseSalary: new Prisma.Decimal(20_000),
      status: 'Active',
      hiredAt: new Date('2026-01-01'),
    },
  });
}

function adjustmentFormData(employeeId: string, overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set('employeeId', employeeId);
  fd.set('kind', 'Income');
  fd.set('reason', 'ค่าคอมมิชชั่น');
  fd.set('amount', '1500');
  fd.set('frequency', 'once');
  fd.set('startMonth', '2026-07');
  fd.set('month', '2026-07');
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
}

beforeEach(reset);
afterAll(async () => {
  await prisma.$disconnect();
});

describe('createRowAdjustment — recalculation-pending contract (Defect 3)', () => {
  it('reports plain success and calls runPayrollDraft when the recalculation also succeeds', async () => {
    const emp = await makeEmployee();

    let thrown: Error | undefined;
    try {
      await createRowAdjustment(adjustmentFormData(emp.id));
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown?.message).toMatch(/^REDIRECT:\/admin\/payroll\?/);
    const message = decodeURIComponent(
      thrown!.message.replace(/^REDIRECT:.*msg=/, '').split('&')[0]!,
    );
    expect(message).not.toContain('คำนวณฉบับร่างใหม่ไม่สำเร็จ');
    expect(runPayrollDraftMock).toHaveBeenCalledWith('2026-07');

    const rows = await prisma.payrollAdjustment.findMany({ where: { employeeId: emp.id } });
    expect(rows).toHaveLength(1);
  });

  it('still commits the adjustment and reports it (recalcPending), instead of throwing, when the recalculation fails — and does not create a second row', async () => {
    const emp = await makeEmployee();
    runPayrollDraftMock.mockRejectedValueOnce(new Error('P2028: transaction timeout'));

    // The whole point of the fix: this call must complete via the normal
    // redirect path, never an unhandled rejection — a thrown error here is
    // exactly what used to prompt an admin to resubmit the same form and
    // create a duplicate adjustment.
    let thrown: Error | undefined;
    try {
      await createRowAdjustment(adjustmentFormData(emp.id));
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown).toBeInstanceOf(Error);
    const message = decodeURIComponent(
      thrown!.message.replace(/^REDIRECT:.*msg=/, '').split('&')[0]!,
    );
    expect(message).toContain('คำนวณฉบับร่างใหม่ไม่สำเร็จ');

    // Exactly one adjustment exists — this single call's failure-handling
    // path did not, itself, write a second row, and (since it never threw)
    // never prompted the admin to resubmit and create one either.
    const rows = await prisma.payrollAdjustment.findMany({ where: { employeeId: emp.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reason).toBe('ค่าคอมมิชชั่น');
  });

  it('reports recalcPending (not a thrown rejection) when runPayrollDraft returns busy instead of throwing', async () => {
    const emp = await makeEmployee();
    // Defect 1: contention now surfaces as a clean `busy` result, not a
    // thrown P2028 — this must be treated the same as the thrown case above.
    runPayrollDraftMock.mockResolvedValueOnce({
      calculated: 0,
      frozen: 0,
      skipped: [],
      busy: true as const,
    });

    let thrown: Error | undefined;
    try {
      await createRowAdjustment(adjustmentFormData(emp.id));
    } catch (err) {
      thrown = err as Error;
    }
    const message = decodeURIComponent(
      thrown!.message.replace(/^REDIRECT:.*msg=/, '').split('&')[0]!,
    );
    expect(message).toContain('คำนวณฉบับร่างใหม่ไม่สำเร็จ');

    const rows = await prisma.payrollAdjustment.findMany({ where: { employeeId: emp.id } });
    expect(rows).toHaveLength(1);
  });
});

describe('deleteRowAdjustment — recalculation-pending contract (Defect 3)', () => {
  it('reports { ok: true } when the recalculation also succeeds', async () => {
    const emp = await makeEmployee();
    const created = await prisma.payrollAdjustment.create({
      data: {
        employeeId: emp.id,
        kind: 'Income',
        reason: 'ค่าคอมมิชชั่น',
        amount: new Prisma.Decimal(1500),
        startMonth: '2026-07',
        endMonth: '2026-07',
      },
    });

    const result = await deleteRowAdjustment(created.id, '2026-07');
    expect(result).toEqual({ ok: true });

    const after = await prisma.payrollAdjustment.findUniqueOrThrow({ where: { id: created.id } });
    expect(after.deletedAt).not.toBeNull();
  });

  it('still reports { ok: true } (never a thrown rejection) when the recalculation throws after the delete already committed', async () => {
    const emp = await makeEmployee();
    const created = await prisma.payrollAdjustment.create({
      data: {
        employeeId: emp.id,
        kind: 'Income',
        reason: 'ค่าคอมมิชชั่น',
        amount: new Prisma.Decimal(1500),
        startMonth: '2026-07',
        endMonth: '2026-07',
      },
    });
    runPayrollDraftMock.mockRejectedValueOnce(new Error('P2028: transaction timeout'));

    // ConfirmDialog (confirm-dialog.tsx) has no try/catch around `await
    // action(...)` — an uncaught rejection here would crash the transition
    // instead of reporting the completed delete as a success.
    const result = await deleteRowAdjustment(created.id, '2026-07');
    expect(result).toEqual({ ok: true });

    const after = await prisma.payrollAdjustment.findUniqueOrThrow({ where: { id: created.id } });
    expect(after.deletedAt).not.toBeNull();
  });

  it('still reports { ok: true } when runPayrollDraft returns busy instead of throwing', async () => {
    const emp = await makeEmployee();
    const created = await prisma.payrollAdjustment.create({
      data: {
        employeeId: emp.id,
        kind: 'Income',
        reason: 'ค่าคอมมิชชั่น',
        amount: new Prisma.Decimal(1500),
        startMonth: '2026-07',
        endMonth: '2026-07',
      },
    });
    runPayrollDraftMock.mockResolvedValueOnce({
      calculated: 0,
      frozen: 0,
      skipped: [],
      busy: true as const,
    });

    const result = await deleteRowAdjustment(created.id, '2026-07');
    expect(result).toEqual({ ok: true });

    const after = await prisma.payrollAdjustment.findUniqueOrThrow({ where: { id: created.id } });
    expect(after.deletedAt).not.toBeNull();
  });
});
