/**
 * Reconcile every LINE-linked user's rich menu with their current capability.
 *
 * This is the backfill + repair tool for the all-dynamic rich-menu model:
 * per-user link failures degrade to a *wrong* or *missing* menu (there is no
 * OA default to fall back to), so this sweep is how we recover. Run it:
 *   - ONCE after cutover, to link the employee menu onto all already-paired
 *     employees (before deleting the OA default menu — see the plan doc).
 *   - Any time menus drift (a failed best-effort sync, a manual DB change,
 *     the 2026-07-01 archive incident leaving stale admin-menu links).
 *
 * It reuses syncRichMenuForUser — the SAME decision the app applies at
 * pairing/merge/role-change time — so there is no divergent policy here.
 *
 * Usage (dry-run by default; prints what it WOULD do):
 *   vercel env pull .env.production
 *   dotenv -e .env.production -- tsx scripts/sync-rich-menus.ts
 *   dotenv -e .env.production -- tsx scripts/sync-rich-menus.ts --apply
 *
 * Requires: DATABASE_URL, LINE_MESSAGING_CHANNEL_ACCESS_TOKEN, and the three
 * menu ids (EMPLOYEE_RICH_MENU_ID / ADMIN_RICH_MENU_ID / COMBINED_RICH_MENU_ID).
 */
import { prisma } from '@/lib/db/prisma';
import { computeMenuTarget, resolveCapabilities, syncRichMenuForUser } from '@/lib/line/rich-menu';

const apply = process.argv.includes('--apply');

async function main() {
  for (const id of ['EMPLOYEE_RICH_MENU_ID', 'ADMIN_RICH_MENU_ID', 'COMBINED_RICH_MENU_ID']) {
    if (!process.env[id]) console.warn(`⚠ ${id} not set — that target will be skipped`);
  }

  // Every user with a LINE binding is a candidate — the resolver decides the
  // target (including 'none' → unlink for archived/no-capability users).
  const users = await prisma.user.findMany({
    where: { lineUserId: { not: null } },
    select: {
      id: true,
      lineUserId: true,
      archivedAt: true,
      employee: { select: { archivedAt: true, nickname: true } },
      roleAssignments: {
        select: { role: { select: { key: true, isSuperadmin: true, archivedAt: true } } },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  const tally = { combined: 0, admin: 0, employee: 0, none: 0 };
  console.log(`${users.length} LINE-linked users\n`);

  for (const u of users) {
    const target = computeMenuTarget(resolveCapabilities(u));
    tally[target] += 1;
    const who = u.employee?.nickname ?? '(admin)';
    console.log(`${apply ? 'sync' : 'plan'}  ${who.padEnd(16)} → ${target}`);
    if (apply) await syncRichMenuForUser(u.id);
  }

  console.log(
    `\n${apply ? 'Applied' : 'Dry-run'}: combined=${tally.combined} admin=${tally.admin} employee=${tally.employee} none=${tally.none}`,
  );
  if (!apply) console.log('Re-run with --apply to push these to LINE.');
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
