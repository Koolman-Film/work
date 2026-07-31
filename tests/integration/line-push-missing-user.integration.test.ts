import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { insertNotificationRow } from '@/lib/inngest/functions/line-push';

/**
 * A queued LINE push whose recipient no longer exists.
 *
 * Notification.userId is a foreign key, so creating a row for a deleted User
 * throws P2003. In production that happened 96 times across 9 users: the
 * push function's graceful handling for missing recipients ran in the step
 * AFTER the insert, so the insert crashed first, burned all three retries,
 * and surfaced as an Inngest function error for a state that would never
 * resolve on its own.
 *
 * This has to be an integration test. The bug is the foreign key, and a
 * mocked Prisma has no foreign keys — it would pass against the broken code.
 */

async function reset() {
  await prisma.notification.deleteMany({});
  await prisma.user.deleteMany({});
}

const payload = {
  kind: 'leave.approved',
  leaveRequestId: '00000000-0000-4000-8000-00000000beef',
} as unknown as Parameters<typeof insertNotificationRow>[1];

describe('insertNotificationRow — recipient may be gone', () => {
  beforeEach(reset);
  afterAll(reset);

  it('creates the row for a live recipient', async () => {
    const user = await prisma.user.create({ data: {} });

    const row = await insertNotificationRow(user.id, payload);

    expect(row).not.toBeNull();
    const stored = await prisma.notification.findUnique({ where: { id: row?.id } });
    expect(stored?.userId).toBe(user.id);
    expect(stored?.channel).toBe('LineMessage');
  });

  it('returns null instead of throwing when the recipient was deleted', async () => {
    const user = await prisma.user.create({ data: {} });
    const orphanedId = user.id;
    await prisma.user.delete({ where: { id: user.id } });

    // Pre-fix this rejected with P2003 and the whole job failed.
    await expect(insertNotificationRow(orphanedId, payload)).resolves.toBeNull();

    // And it must not have written a half-row on the way out.
    expect(await prisma.notification.count()).toBe(0);
  });

  it('returns null for an id that never existed', async () => {
    await expect(
      insertNotificationRow('00000000-0000-4000-8000-000000000000', payload),
    ).resolves.toBeNull();
    expect(await prisma.notification.count()).toBe(0);
  });

  it('still creates the row for an ARCHIVED recipient', async () => {
    // Archived is not deleted: the row is still written and the caller
    // decides not to push. Changing that here would silently drop the
    // in-app bell entry for archived users.
    const user = await prisma.user.create({ data: { archivedAt: new Date() } });

    const row = await insertNotificationRow(user.id, payload);

    expect(row).not.toBeNull();
    expect(await prisma.notification.count()).toBe(1);
  });
});
