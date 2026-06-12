/**
 * Unit tests for notifyAdminsOnLine — the LINE-push sibling of
 * notifyAdminsInApp. prisma + sendNotification are stubbed at the
 * module boundary (same mocking style as require-role-line-fallback.test.ts).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('@/lib/inngest/events', () => ({
  sendNotification: vi.fn(),
}));

import { prisma } from '@/lib/db/prisma';
import { sendNotification } from '@/lib/inngest/events';
import { notifyAdminsOnLine } from './admin-line';

const mockedFindMany = vi.mocked(prisma.user.findMany);
const mockedSend = vi.mocked(sendNotification);

const payload = {
  kind: 'admin.leave-submitted' as const,
  leaveRequestId: 'lr-1',
  employeeName: 'สมชาย ใจดี',
  leaveTypeName: 'ลาป่วย',
  startDate: '2026-06-15',
  endDate: '2026-06-16',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('notifyAdminsOnLine', () => {
  it('sends one notification per paired admin with the exact payload', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: minimal prisma stub
    mockedFindMany.mockResolvedValue([{ id: 'admin-1' }, { id: 'admin-2' }] as any);
    mockedSend.mockResolvedValue(undefined);

    await notifyAdminsOnLine(payload);

    // recipient predicate: active + paired (lineUserId required) + admin role
    expect(mockedFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          archivedAt: null,
          lineUserId: { not: null },
          roleAssignments: {
            some: expect.objectContaining({
              role: expect.objectContaining({
                archivedAt: null,
                OR: expect.arrayContaining([
                  { isSuperadmin: true },
                  { permissions: { has: 'liff.admin' } },
                ]),
              }),
            }),
          },
        }),
      }),
    );
    expect(mockedSend).toHaveBeenCalledTimes(2);
    expect(mockedSend).toHaveBeenCalledWith('admin-1', payload);
    expect(mockedSend).toHaveBeenCalledWith('admin-2', payload);
  });

  it('does nothing when no paired admins exist', async () => {
    mockedFindMany.mockResolvedValue([]);

    await expect(notifyAdminsOnLine(payload)).resolves.toBeUndefined();
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it('swallows prisma failures (fire-and-forget) and logs', async () => {
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedFindMany.mockRejectedValue(new Error('db down'));

    await expect(notifyAdminsOnLine(payload)).resolves.toBeUndefined();
    expect(mockedSend).not.toHaveBeenCalled();
    expect(consoleErr).toHaveBeenCalledWith(
      '[notifyAdminsOnLine] failed (non-fatal)',
      expect.objectContaining({ kind: 'admin.leave-submitted', error: 'db down' }),
    );
    consoleErr.mockRestore();
  });

  it('swallows sendNotification failures too', async () => {
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
    // biome-ignore lint/suspicious/noExplicitAny: minimal prisma stub
    mockedFindMany.mockResolvedValue([{ id: 'admin-1' }] as any);
    mockedSend.mockRejectedValue(new Error('inngest down'));

    await expect(notifyAdminsOnLine(payload)).resolves.toBeUndefined();
    expect(consoleErr).toHaveBeenCalled();
    consoleErr.mockRestore();
  });

  it('first admin fails, second still receives notification (allSettled fan-out)', async () => {
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
    // biome-ignore lint/suspicious/noExplicitAny: minimal prisma stub
    mockedFindMany.mockResolvedValue([{ id: 'admin-1' }, { id: 'admin-2' }] as any);
    mockedSend
      .mockRejectedValueOnce(new Error('line push failed'))
      .mockResolvedValueOnce(undefined);

    await expect(notifyAdminsOnLine(payload)).resolves.toBeUndefined();

    // both recipients attempted
    expect(mockedSend).toHaveBeenCalledTimes(2);
    expect(mockedSend).toHaveBeenCalledWith('admin-1', payload);
    expect(mockedSend).toHaveBeenCalledWith('admin-2', payload);

    // the rejection was logged individually, not thrown
    expect(consoleErr).toHaveBeenCalledWith(
      '[notifyAdminsOnLine] one recipient failed (non-fatal)',
      expect.objectContaining({ kind: 'admin.leave-submitted', error: 'line push failed' }),
    );
    consoleErr.mockRestore();
  });
});
