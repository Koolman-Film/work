import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { addSeenIds } from '@/lib/product-updates/seen-store';

/**
 * The seen-set union happens in Postgres. These pin that it is add-only,
 * tolerates a null or malformed column, and — the reason it moved into SQL —
 * that two saves landing together both survive.
 */

async function userWith(seen: unknown) {
  return prisma.user.create({
    data: { productUpdatesSeen: seen === null ? undefined : (seen as object) },
  });
}
const seenOf = async (id: string) =>
  (await prisma.user.findUniqueOrThrow({ where: { id } })).productUpdatesSeen;

afterAll(async () => {
  await prisma.$disconnect();
});

describe('addSeenIds', () => {
  beforeEach(async () => {
    await prisma.user.deleteMany({});
  });

  it('unions into the existing set, sorted and de-duplicated', async () => {
    const u = await userWith(['b']);
    await addSeenIds(u.id, ['c', 'a', 'b']);
    expect(await seenOf(u.id)).toEqual(['a', 'b', 'c']);
  });

  it('treats a null or non-array column as empty', async () => {
    const empty = await userWith(null);
    await addSeenIds(empty.id, ['x']);
    expect(await seenOf(empty.id)).toEqual(['x']);
    const junk = await userWith({ not: 'an array' });
    await addSeenIds(junk.id, ['y']);
    expect(await seenOf(junk.id)).toEqual(['y']);
  });

  it('two concurrent saves both survive', async () => {
    const u = await userWith([]);
    await Promise.all([
      addSeenIds(u.id, ['first-run.welcome']),
      addSeenIds(u.id, ['branch-settings-2026-11', 'ui-refresh-2026-09']),
    ]);
    expect(await seenOf(u.id)).toEqual([
      'branch-settings-2026-11',
      'first-run.welcome',
      'ui-refresh-2026-09',
    ]);
  });
});
