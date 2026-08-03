import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Every payroll audit write must carry a real Payroll UUID.
 *
 * `AuditLog.entityId` is `@db.Uuid`, and `auditLog` is fire-and-forget with a
 * catch — so a call site passing anything else fails 100% of the time and
 * says nothing. All five payroll sites passed the month string ("2026-08"),
 * and the loss ran from 2026-06-17 to 2026-07-31 before the logs were read.
 *
 * There IS already a guard in audit/log.ts that throws on a non-UUID outside
 * production. It did not help, for a reason worth remembering: it only fires
 * when something calls the action, and nothing did. This file is that
 * something — it invokes each action and asserts on what reached the audit
 * layer, so the guard now has a trigger.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const auditLog = vi.fn();
const auditLogMany = vi.fn();
vi.mock('@/lib/audit/log', () => ({
  auditLog: (...a: unknown[]) => auditLog(...a),
  auditLogMany: (...a: unknown[]) => auditLogMany(...a),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (u: string) => {
    throw new Error(`REDIRECT:${u}`);
  },
}));
vi.mock('next/server', () => ({ after: (fn: () => void) => fn() }));

vi.mock('@/lib/auth/check-permission', () => ({
  requirePermission: vi.fn(async () => ({ user: { id: ACTOR } })),
  canDo: vi.fn(async () => true),
  getUserAssignments: vi.fn(async () => [
    { branchId: null, role: { permissions: [], isSuperadmin: true, archivedAt: null } },
  ]),
}));

const runPayrollDraft = vi.fn();
const publishPayroll = vi.fn();
const lockPayroll = vi.fn();
vi.mock('@/lib/payroll/run', () => ({
  runPayrollDraft: (...a: unknown[]) => runPayrollDraft(...a),
  publishPayroll: (...a: unknown[]) => publishPayroll(...a),
  lockPayroll: (...a: unknown[]) => lockPayroll(...a),
  payrollRowDetail: vi.fn(),
}));
vi.mock('@/lib/inngest/events', () => ({ sendNotification: vi.fn() }));
vi.mock('./adjustments/adjustment-schema', () => ({ readForm: vi.fn() }));

const employeeFindMany = vi.fn(async (..._args: unknown[]) => [] as unknown[]);
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    payroll: { findFirst: vi.fn() },
    employee: { findMany: (...a: unknown[]) => employeeFindMany(...a) },
  },
}));

import { calculatePayrollAction, lockPayrollAction, publishPayrollAction } from './actions';

const ACTOR = '99999999-9999-4999-8999-999999999999';
const PAYROLL_A = '11111111-1111-4111-8111-111111111111';
const PAYROLL_B = '22222222-2222-4222-8222-222222222222';
const EMP_A = '33333333-3333-4333-8333-333333333333';
const MONTH = '2026-08';

function form(month = MONTH): FormData {
  const fd = new FormData();
  fd.set('month', month);
  return fd;
}

/** Every entityId handed to the audit layer, from either entry point. */
function auditedEntityIds(): string[] {
  const single = auditLog.mock.calls.map((c) => (c[0] as { entityId: string }).entityId);
  const many = auditLogMany.mock.calls.flatMap((c) =>
    (c[0] as Array<{ entityId: string }>).map((r) => r.entityId),
  );
  return [...single, ...many];
}

/** The actions end in redirect(), which the mock turns into a throw. */
async function runIgnoringRedirect(fn: () => Promise<unknown>) {
  await fn().catch((e: unknown) => {
    if (!(e instanceof Error) || !e.message.startsWith('REDIRECT:')) throw e;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  employeeFindMany.mockResolvedValue([]);
});

describe('payroll audit writes carry real Payroll UUIDs', () => {
  it('payroll.run audits each recalculated row, not the month', async () => {
    runPayrollDraft.mockResolvedValue({
      calculated: 2,
      calculatedPayrollIds: [PAYROLL_A, PAYROLL_B],
      frozen: 0,
      skipped: [],
    });

    await runIgnoringRedirect(() => calculatePayrollAction(form()));

    const ids = auditedEntityIds();
    expect(ids).toEqual([PAYROLL_A, PAYROLL_B]);
    for (const id of ids) expect(id).toMatch(UUID_RE);
    // The month is still recorded — just not in the UUID column.
    expect(auditLogMany.mock.calls[0]?.[0][0].metadata).toMatchObject({ month: MONTH });
  });

  it('payroll.publish audits each published slip', async () => {
    publishPayroll.mockResolvedValue({
      published: [
        { payrollId: PAYROLL_A, employeeId: EMP_A, recipientUserId: ACTOR },
        { payrollId: PAYROLL_B, employeeId: EMP_A, recipientUserId: ACTOR },
      ],
      skipped: [],
      blocked: [],
    });

    await runIgnoringRedirect(() => publishPayrollAction(form()));

    const ids = auditedEntityIds();
    expect(ids).toEqual([PAYROLL_A, PAYROLL_B]);
    for (const id of ids) expect(id).toMatch(UUID_RE);
  });

  it('the lock phase audits each locked row', async () => {
    lockPayroll.mockResolvedValue([PAYROLL_A, PAYROLL_B]);

    await runIgnoringRedirect(() => lockPayrollAction(form()));

    const ids = auditedEntityIds();
    expect(ids).toEqual([PAYROLL_A, PAYROLL_B]);
    for (const id of ids) expect(id).toMatch(UUID_RE);
  });

  it('writes nothing when a run touched no rows', async () => {
    // Not a silent-failure case: there is genuinely no entity to point at, so
    // the correct trail is empty rather than a row naming the month.
    runPayrollDraft.mockResolvedValue({
      calculated: 0,
      calculatedPayrollIds: [],
      frozen: 3,
      skipped: [],
    });

    await runIgnoringRedirect(() => calculatePayrollAction(form()));

    expect(auditedEntityIds()).toEqual([]);
  });
});
