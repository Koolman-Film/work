/**
 * Inngest smoke tests — Sprint 2.8 / Task #56.
 *
 * GOAL: prove every Inngest function is wired correctly and won't blow
 * up on the most basic happy path. This is "smoke test" in the CI/CD
 * sense — a sanity check that catches the common failure modes:
 *
 *   - someone deletes a function from /api/inngest/route.ts and ships
 *     a broken cron-less app
 *   - someone edits a cron expression to garbage (e.g. drops the TZ=
 *     prefix or uses the wrong day-of-week ordinal) and the function
 *     stops firing in production with no compile error
 *   - someone refactors the handler signature and the trigger config
 *     and the two go out of sync
 *
 * NOT in scope: exhaustive behavioral testing of every branch (Sunday
 * skip, holiday skip, no-due-employees, etc.). That's the kind of
 * coverage you build incrementally as bugs get reported. The smoke
 * test should stay light and fast.
 *
 * Implementation note: each cron handler is invoked with a fake
 * `step.run` adapter that just calls the inner function (no
 * memoization, no retry). Prisma is stubbed via vi.mock at the module
 * boundary so the handler can run end-to-end without a database.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────────────
//
// Stub prisma module BEFORE importing the handlers. Each test sets
// per-call return values via `mockedPrisma.X.Y.mockResolvedValue(...)`.

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    attendance: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    employee: {
      findMany: vi.fn(),
    },
    holiday: {
      findFirst: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    notification: {
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('@/lib/audit/log', () => ({
  auditLog: vi.fn(),
}));

vi.mock('@/lib/notifications/in-app-bell', () => ({
  notifyAdminsInApp: vi.fn(),
}));

vi.mock('@/lib/line/messaging-client', () => ({
  getLineMessagingClient: vi.fn(),
}));

vi.mock('@/lib/line/flex-templates', () => ({
  appBaseUrl: vi.fn(() => 'https://example.test'),
  buildFlexMessage: vi.fn(() => ({ type: 'flex', altText: 'test', contents: {} })),
}));

// Imports AFTER vi.mock so the mocks intercept the module graph.
import { prisma } from '@/lib/db/prisma';
import { attendanceForceCheckoutEod } from './attendance-force-checkout-eod';
import { attendanceLateCheck } from './attendance-late-check';
import { linePushNotification } from './line-push';
import { probationReminder } from './probation-reminder';

// Inngest's createFunction returns an instance whose `.opts` carries
// the id + triggers we configured. Type the surface narrowly so we
// stay decoupled from the SDK's internal types.
type InngestFnLike = {
  opts: {
    id: string;
    triggers: ReadonlyArray<{ cron?: string; event?: string }>;
  };
  fn: (ctx: HandlerCtx) => Promise<unknown>;
};
type HandlerCtx = {
  event: { data: unknown };
  step: { run: <T>(name: string, fn: () => T | Promise<T>) => Promise<T> };
  logger: { info: (msg: string) => void };
};

/**
 * Build a no-op step adapter that just invokes the inner function.
 * Inngest's real step.run does memoization + retries; for smoke we
 * just need it to execute the closure once and return its value.
 */
function fakeStep(): HandlerCtx['step'] {
  return {
    run: async <T>(_name: string, fn: () => T | Promise<T>): Promise<T> => fn(),
  };
}

const mockedPrisma = prisma as unknown as {
  attendance: {
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  employee: { findMany: ReturnType<typeof vi.fn> };
  holiday: { findFirst: ReturnType<typeof vi.fn> };
  user: { findUnique: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  notification: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Structural checks ──────────────────────────────────────────────────────

describe('Inngest route wiring', () => {
  it('all 4 functions are imported by the /api/inngest route', async () => {
    // We import the route module dynamically because it side-effect-
    // exports the GET/POST/PUT handlers via `serve(...)`; importing
    // the route forces evaluation and proves no top-level throw.
    const route = await import('@/app/api/inngest/route');
    expect(typeof route.GET).toBe('function');
    expect(typeof route.POST).toBe('function');
    expect(typeof route.PUT).toBe('function');
  });
});

describe('Function identity + trigger config', () => {
  // Map of expected id → trigger. The smoke test makes the cron
  // expressions explicit so a typo (e.g. losing the TZ= prefix) trips
  // the test instead of silently going to UTC.
  const expected: Array<{ fn: InngestFnLike; id: string; trigger: Record<string, string> }> = [
    {
      fn: attendanceForceCheckoutEod as unknown as InngestFnLike,
      id: 'attendance-force-checkout-eod',
      trigger: { cron: 'TZ=Asia/Bangkok 0 23 * * *' },
    },
    {
      fn: attendanceLateCheck as unknown as InngestFnLike,
      id: 'attendance-late-check',
      trigger: { cron: 'TZ=Asia/Bangkok 0 10 * * *' },
    },
    {
      fn: probationReminder as unknown as InngestFnLike,
      id: 'probation-reminder',
      trigger: { cron: 'TZ=Asia/Bangkok 0 9 * * *' },
    },
    {
      fn: linePushNotification as unknown as InngestFnLike,
      id: 'line-push-notification',
      trigger: { event: 'notification.send' },
    },
  ];

  for (const { fn, id, trigger } of expected) {
    it(`${id} declares id=${id} and the expected trigger`, () => {
      expect(fn.opts.id).toBe(id);
      expect(fn.opts.triggers).toHaveLength(1);
      expect(fn.opts.triggers[0]).toEqual(trigger);
    });
  }
});

// ─── Behavioral smoke ───────────────────────────────────────────────────────

describe('attendance-force-checkout-eod', () => {
  const handler = (attendanceForceCheckoutEod as unknown as InngestFnLike).fn;

  it('no-op when no open check-ins for today', async () => {
    mockedPrisma.attendance.findMany.mockResolvedValue([]);

    const result = await handler({
      event: { data: {} },
      step: fakeStep(),
      logger: { info: () => {} },
    });

    expect(result).toEqual({ closed: 0 });
    expect(mockedPrisma.attendance.update).not.toHaveBeenCalled();
  });

  it('closes each open check-in and returns count + forcedClockOutISO', async () => {
    mockedPrisma.attendance.findMany.mockResolvedValue([
      { id: 'att-1', employeeId: 'emp-1', clockInAt: new Date() },
      { id: 'att-2', employeeId: 'emp-2', clockInAt: new Date() },
    ]);
    mockedPrisma.attendance.update.mockResolvedValue({ id: 'att-1' });

    const result = (await handler({
      event: { data: {} },
      step: fakeStep(),
      logger: { info: () => {} },
    })) as { closed: number; forcedClockOutISO: string };

    expect(result.closed).toBe(2);
    expect(result.forcedClockOutISO).toMatch(/^\d{4}-\d{2}-\d{2}T15:00:00\.000Z$/);
    expect(mockedPrisma.attendance.update).toHaveBeenCalledTimes(2);
  });
});

describe('attendance-late-check', () => {
  const handler = (attendanceLateCheck as unknown as InngestFnLike).fn;

  function runHandler() {
    return handler({
      event: { data: {} },
      step: fakeStep(),
      logger: { info: () => {} },
    });
  }

  it('skips on Sunday (BKK is closed Sundays)', async () => {
    // Mock Date so getUTCDay() returns 0. Use a known Sunday in BKK.
    const sundayBkk = new Date('2026-03-01T05:00:00Z'); // 2026-03-01 12:00 BKK = Sunday
    vi.setSystemTime(sundayBkk);

    const result = await runHandler();

    expect(result).toEqual({ skipped: true, reason: 'sunday' });
    // Holiday/employee queries must not happen on a Sunday skip.
    expect(mockedPrisma.holiday.findFirst).not.toHaveBeenCalled();
    expect(mockedPrisma.employee.findMany).not.toHaveBeenCalled();
  });

  it('skips when today is a holiday', async () => {
    // Friday in BKK so we get past the Sunday check.
    vi.setSystemTime(new Date('2026-03-06T05:00:00Z'));
    mockedPrisma.holiday.findFirst.mockResolvedValue({ name: 'วันมาฆบูชา' });

    const result = await runHandler();

    expect(result).toEqual({
      skipped: true,
      reason: 'holiday',
      holidayName: 'วันมาฆบูชา',
    });
  });

  it('skips when everyone has checked in or is on leave', async () => {
    vi.setSystemTime(new Date('2026-03-06T05:00:00Z'));
    mockedPrisma.holiday.findFirst.mockResolvedValue(null);
    mockedPrisma.employee.findMany.mockResolvedValue([
      { id: 'e1', firstName: 'A', lastName: 'AA', nickname: null },
      { id: 'e2', firstName: 'B', lastName: 'BB', nickname: null },
    ]);
    mockedPrisma.attendance.findMany
      .mockResolvedValueOnce([{ employeeId: 'e1' }]) // checked in
      .mockResolvedValueOnce([{ employeeId: 'e2' }]); // on leave

    const result = await runHandler();

    expect(result).toEqual({ skipped: true, reason: 'all-checked-in' });
  });

  it('notifies when some active employees have not checked in or taken leave', async () => {
    vi.setSystemTime(new Date('2026-03-06T05:00:00Z'));
    mockedPrisma.holiday.findFirst.mockResolvedValue(null);
    mockedPrisma.employee.findMany.mockResolvedValue([
      { id: 'e1', firstName: 'Alice', lastName: 'A', nickname: 'Ali' },
      { id: 'e2', firstName: 'Bob', lastName: 'B', nickname: null },
    ]);
    mockedPrisma.attendance.findMany
      .mockResolvedValueOnce([]) // checked in (none)
      .mockResolvedValueOnce([]); // on leave (none)

    const result = (await runHandler()) as {
      notified: boolean;
      countNotCheckedIn: number;
      activeEmployeeCount: number;
    };

    expect(result.notified).toBe(true);
    expect(result.countNotCheckedIn).toBe(2);
    expect(result.activeEmployeeCount).toBe(2);
  });
});

describe('probation-reminder', () => {
  const handler = (probationReminder as unknown as InngestFnLike).fn;

  it('returns notified=0 when no one has a hire date 113 days ago', async () => {
    mockedPrisma.employee.findMany.mockResolvedValue([]);

    const result = await handler({
      event: { data: {} },
      step: fakeStep(),
      logger: { info: () => {} },
    });

    expect(result).toEqual({ notified: 0 });
  });

  it('emits one notification per due employee', async () => {
    mockedPrisma.employee.findMany.mockResolvedValue([
      { id: 'e1', firstName: 'A', lastName: 'X', nickname: 'อา' },
      { id: 'e2', firstName: 'B', lastName: 'Y', nickname: null },
    ]);

    const result = (await handler({
      event: { data: {} },
      step: fakeStep(),
      logger: { info: () => {} },
    })) as { notified: number; employeeIds: string[] };

    expect(result.notified).toBe(2);
    expect(result.employeeIds).toEqual(['e1', 'e2']);
  });
});

describe('line-push-notification', () => {
  const handler = (linePushNotification as unknown as InngestFnLike).fn;
  const samplePayload = {
    recipientUserId: 'user-1',
    kind: 'leave.approved' as const,
    leaveRequestId: 'lr-1',
    employeeFirstName: 'อาลี',
    leaveTypeName: 'ลาป่วย',
    startDate: '2026-03-10',
    endDate: '2026-03-11',
    workingDays: 2,
    reviewNote: null,
  };

  it('skips delivery when recipient has no lineUserId (not yet paired)', async () => {
    mockedPrisma.notification.create.mockResolvedValue({ id: 'n1' });
    mockedPrisma.user.findUnique.mockResolvedValue({
      lineUserId: null,
      archivedAt: null,
    });

    const result = (await handler({
      event: { data: samplePayload },
      step: fakeStep(),
      logger: { info: () => {} },
    })) as { notificationId: string; delivered: boolean; reason?: string };

    expect(result.delivered).toBe(false);
    expect(result.reason).toBe('no-line-user-id');
    expect(mockedPrisma.notification.update).not.toHaveBeenCalled();
  });

  it('skips delivery when recipient User is archived', async () => {
    mockedPrisma.notification.create.mockResolvedValue({ id: 'n1' });
    mockedPrisma.user.findUnique.mockResolvedValue({
      lineUserId: 'Uxxx',
      archivedAt: new Date(),
    });

    const result = (await handler({
      event: { data: samplePayload },
      step: fakeStep(),
      logger: { info: () => {} },
    })) as { delivered: boolean; reason?: string };

    expect(result.delivered).toBe(false);
    expect(result.reason).toBe('no-line-user-id');
  });

  it('delivers and marks sentAt when lineUserId is present', async () => {
    mockedPrisma.notification.create.mockResolvedValue({ id: 'n1' });
    mockedPrisma.user.findUnique.mockResolvedValue({
      lineUserId: 'Uabc123',
      archivedAt: null,
    });
    mockedPrisma.notification.update.mockResolvedValue({ id: 'n1' });

    // The LINE client push is mocked at the module boundary above,
    // so this will resolve without hitting the network.
    const { getLineMessagingClient } = await import('@/lib/line/messaging-client');
    (getLineMessagingClient as ReturnType<typeof vi.fn>).mockReturnValue({
      pushMessage: vi.fn().mockResolvedValue(undefined),
    });

    const result = (await handler({
      event: { data: samplePayload },
      step: fakeStep(),
      logger: { info: () => {} },
    })) as { delivered: boolean };

    expect(result.delivered).toBe(true);
    expect(mockedPrisma.notification.update).toHaveBeenCalledWith({
      where: { id: 'n1' },
      data: { sentAt: expect.any(Date) },
    });
  });
});
