import 'server-only';

/**
 * Who may receive an admin LINE push.
 *
 * This file used to also hold `notifyAdminsOnLine`, a per-event fan-out that
 * sent one push per admin per leave/advance/dispute submission. That was 65%
 * of July 2026's 464-message spend against a 300/month cap — its cost scaled
 * with the number of admins rather than the amount of work, so linking a
 * third admin was enough to exhaust the quota. It was replaced by the 08:30
 * digest (`admin-daily-digest.ts`), which sends each admin one message
 * summarising what is still pending, and nothing at all on quiet days.
 *
 * What remains is the recipient predicate, kept here and shared so the digest
 * can never target a different set of people than the old pushes did.
 *
 * `import 'server-only'` (not `'use server'`): the sole export returns the
 * list of admin User IDs and has no auth check of its own — `'use server'`
 * would mark it a Next.js Server Action, callable from any client with zero
 * arguments, handing out that ID list to whoever asks. Its only caller is
 * the digest cron (`admin-daily-digest.ts`), which runs server-side; nothing
 * here needs to be invocable from the browser.
 */

import { prisma } from '@/lib/db/prisma';

/**
 * Admins who can receive LINE pushes: archived-free, LINE-linked, and
 * holding `liff.admin` (or Superadmin). Shared with the daily digest cron
 * (`admin-daily-digest.ts`) so the two can never target different people —
 * do NOT copy this `where` clause anywhere else.
 */
export async function linePushAdminIds(): Promise<string[]> {
  const recipients = await prisma.user.findMany({
    where: {
      archivedAt: null,
      lineUserId: { not: null },
      roleAssignments: {
        some: {
          // Target liff.admin holders (not just role.key === 'admin'):
          // the push deep-links into /liff/admin/* pages, which 404 for
          // anyone without that permission — a custom admin role that
          // lacks liff.admin must not receive dead-end pushes, and a
          // custom role that HAS it should. Superadmin short-circuits.
          role: {
            archivedAt: null,
            OR: [{ isSuperadmin: true }, { permissions: { has: 'liff.admin' } }],
          },
        },
      },
    },
    select: { id: true },
  });
  return recipients.map((r) => r.id);
}
