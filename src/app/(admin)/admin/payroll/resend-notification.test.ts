import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (u: string) => {
    throw new Error(`REDIRECT:${u}`);
  },
}));
vi.mock('next/server', () => ({ after: (fn: () => void) => fn() }));
vi.mock('@/lib/audit/log', () => ({ auditLog: vi.fn() }));

const requirePermission = vi.fn();
vi.mock('@/lib/auth/check-permission', () => ({
  requirePermission: (...a: unknown[]) => requirePermission(...a),
}));

const sendNotification = vi.fn();
vi.mock('@/lib/inngest/events', () => ({
  sendNotification: (...a: unknown[]) => sendNotification(...a),
}));

// Shield the engine/warm modules actions.ts imports at module load.
vi.mock('@/lib/payroll/run', () => ({
  publishPayroll: vi.fn(),
  lockPayroll: vi.fn(),
  notifyPublishedSlips: vi.fn(),
  payrollRowDetail: vi.fn(),
  runPayrollDraft: vi.fn(),
}));
vi.mock('@/lib/payslip/warm', () => ({ warmPublishedPayslips: vi.fn() }));
vi.mock('./adjustments/adjustment-schema', () => ({ readForm: vi.fn() }));

const payrollFindFirst = vi.fn();
vi.mock('@/lib/db/prisma', () => ({
  prisma: { payroll: { findFirst: (...a: unknown[]) => payrollFindFirst(...a) } },
}));

import { resendPayslipNotificationAction } from './actions';

const VALID_EMP = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue({ user: { id: 'actor' } });
});

describe('resendPayslipNotificationAction', () => {
  it('rejects a malformed month', async () => {
    const r = await resendPayslipNotificationAction(VALID_EMP, '2026-13');
    expect(r.ok).toBe(false);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('rejects a malformed employee id', async () => {
    const r = await resendPayslipNotificationAction('not-a-uuid', '2026-06');
    expect(r.ok).toBe(false);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('errors when the slip is not published', async () => {
    payrollFindFirst.mockResolvedValue(null);
    const r = await resendPayslipNotificationAction(VALID_EMP, '2026-06');
    expect(r).toEqual({ ok: false, message: 'ยังไม่ได้เผยแพร่สลิปงวดนี้' });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('errors when the employee has no linked LINE account', async () => {
    payrollFindFirst.mockResolvedValue({
      id: 'pay1',
      netPay: { toNumber: () => 28500 },
      employee: { firstName: 'Aung', userId: 'u1', user: { lineUserId: null } },
    });
    const r = await resendPayslipNotificationAction(VALID_EMP, '2026-06');
    expect(r.ok).toBe(false);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('re-queues the flex with a fresh dedupeSuffix and the published payload', async () => {
    payrollFindFirst.mockResolvedValue({
      id: 'pay1',
      netPay: { toNumber: () => 28500 },
      employee: { firstName: 'Aung', userId: 'u1', user: { lineUserId: 'L1' } },
    });
    const r = await resendPayslipNotificationAction(VALID_EMP, '2026-06');
    expect(r).toEqual({ ok: true });
    expect(sendNotification).toHaveBeenCalledTimes(1);
    const [recipient, payload, opts] = sendNotification.mock.calls[0];
    expect(recipient).toBe('u1');
    expect(payload).toMatchObject({
      kind: 'payroll.published',
      payrollId: 'pay1',
      month: '2026-06',
      employeeFirstName: 'Aung',
      netPay: '28,500.00',
    });
    // Fresh per call AND tagged as a resend — distinguishes a resend event id
    // from any future suffix use, and guarantees it escapes the dedup window.
    expect(opts.dedupeSuffix).toMatch(/^resend-[0-9a-z]+$/);
  });
});
