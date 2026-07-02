/**
 * One-off ops: unlink the LINE binding from every admin-role User.
 *
 * For each User that (a) holds an active admin or superadmin role and (b) has a
 * lineUserId, this unlinks their LINE rich menu (so their LINE falls back to the
 * OA default menu) and clears the binding (lineUserId + any pending invite token).
 *
 * Dry-run by default (prints the affected accounts, mutates nothing).
 * Pass --apply to actually unlink.
 *
 * Needs PRODUCTION env: DATABASE_URL (+ optionally DIRECT_URL) and
 * LINE_MESSAGING_CHANNEL_ACCESS_TOKEN. Run with:
 *   vercel env pull .env.production
 *   node --env-file=.env.production scripts/unlink-admin-line.mjs          # dry run
 *   node --env-file=.env.production scripts/unlink-admin-line.mjs --apply  # do it
 */
import { messagingApi } from '@line/bot-sdk';
import { PrismaClient } from '@prisma/client';

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();
const token = process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN;
const client = token ? new messagingApi.MessagingApiClient({ channelAccessToken: token }) : null;

// Admin-role users (active admin OR superadmin role) that currently hold a LINE binding.
const rows = await prisma.$queryRaw`
  SELECT u.id, u."lineUserId" AS "lineUserId", u.email,
         EXISTS (SELECT 1 FROM "Employee" e WHERE e."userId" = u.id) AS "isEmployee"
  FROM "User" u
  WHERE u."lineUserId" IS NOT NULL AND u."archivedAt" IS NULL
    AND EXISTS (
      SELECT 1 FROM "UserRoleAssignment" a
      JOIN "RoleDefinition" r ON r.id = a."roleId"
      WHERE a."userId" = u.id AND r."archivedAt" IS NULL
        AND (r."isSuperadmin" = true OR r.key = 'admin'))`;

console.log(`Found ${rows.length} admin-role user(s) with a LINE binding:\n`);
for (const r of rows) {
  console.log(
    `  ${r.id}  line=${r.lineUserId}  ${r.email ?? '(no email)'}  ${r.isEmployee ? '⚠ ALSO EMPLOYEE (breaks check-in)' : ''}`,
  );
}

if (!APPLY) {
  console.log('\nDRY RUN — nothing changed. Re-run with --apply to unlink.');
  await prisma.$disconnect();
  process.exit(0);
}
if (!client) {
  console.error('\nLINE_MESSAGING_CHANNEL_ACCESS_TOKEN not set — cannot unlink rich menus. Aborting.');
  await prisma.$disconnect();
  process.exit(1);
}

let done = 0;
for (const r of rows) {
  try {
    await client.unlinkRichMenuIdFromUser(r.lineUserId);
  } catch (e) {
    console.warn(`  rich-menu unlink failed for ${r.lineUserId} (continuing): ${String(e)}`);
  }
  await prisma.user.update({
    where: { id: r.id },
    data: { lineUserId: null, lineInviteToken: null, lineInviteExpiresAt: null },
  });
  done++;
  console.log(`  ✓ unlinked ${r.id} (${r.email ?? 'no email'})`);
}
console.log(`\n✓ Done — unlinked ${done}/${rows.length} admin LINE binding(s).`);
await prisma.$disconnect();
