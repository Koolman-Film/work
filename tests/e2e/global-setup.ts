import { PrismaClient } from '@prisma/client';
import { UPDATES } from '@/lib/product-updates/registry';

/**
 * Retires both of the admin shell's first-run experiences, for everyone.
 *
 * On a database anyone has clicked around in, these have already been
 * dismissed and never appear — which is why they stayed invisible for as long
 * as e2e only ever ran against a developer's own stack. On CI's freshly-seeded
 * database they fire on the first admin page load of every spec and swallow
 * every click behind a full-screen overlay. 28 specs failed that way, each
 * burning its whole 30s timeout while Playwright reported the overlay
 * "intercepts pointer events".
 *
 * There are TWO of them, and they are mutually exclusive by design — which is
 * how the second one hid behind the first:
 *
 *   1. `<ProductUpdates>` opens a modal for any `announce: true` item the user
 *      has not seen.
 *   2. When no such item is pending, it auto-starts the driver.js welcome tour
 *      instead, guarded by the `first-run.welcome` marker.
 *
 * Suppressing only the updates satisfies `nextAnnounce(...) === null`, which
 * ENABLES the tour — the fix for the first blocker summons the second. Both
 * markers live in the same `productUpdatesSeen` set, so one write covers them.
 *
 * Done once here rather than dismissed per spec: one UPDATE instead of an
 * overlay round-trip in all 47, and the specs stay about the behaviour they
 * actually test. A spec that wants to exercise the welcome flow itself should
 * set its own user's state.
 */

/** Mirrors product-updates.tsx — the marker recording that the tour has run. */
const FIRST_RUN_KEY = 'first-run.welcome';

export default async function globalSetup(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await prisma.user.updateMany({
      data: { productUpdatesSeen: [...UPDATES.map((u) => u.id), FIRST_RUN_KEY] },
    });
  } finally {
    await prisma.$disconnect();
  }
}
