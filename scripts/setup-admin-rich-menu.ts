/**
 * One-off: create the ADMIN rich menu + upload its image, print the id.
 * Usage: pnpm tsx scripts/setup-admin-rich-menu.ts ./assets/rich-menu/admin-rich-menu-placeholder.png [old-richmenu-id]
 * Env: LINE_MESSAGING_CHANNEL_ACCESS_TOKEN + NEXT_PUBLIC_APP_URL + NEXT_PUBLIC_LIFF_ID must be set.
 * Then set ADMIN_RICH_MENU_ID=<printed id> in the deploy env.
 *
 * If [old-richmenu-id] is given, every user currently linked to it is
 * re-linked to the new menu and the old menu is deleted (rotation —
 * LINE rich menus are immutable, so image/area changes need a new menu).
 * The per-user link list isn't queryable from LINE, so rotation relinks
 * the users we know about: it reads paired admin lineUserIds from the
 * DATABASE_URL Postgres if set, else relinks nobody and tells you.
 *
 * Image: 2500x1686 px, three equal columns, JPEG/PNG <= 1MB.
 *
 * Tap areas funnel through liff.line.me (?liff.state=?dest=...) — NOT
 * direct app URLs: LINE's plain in-app browser has a separate cookie
 * jar from the LIFF browser, so direct links open sessionless. The
 * /liff/pair endpoint dispatches ?dest= to the admin pages.
 */
import { existsSync, readFileSync } from 'node:fs';
import { messagingApi } from '@line/bot-sdk';

const token = process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN;
const base = process.env.NEXT_PUBLIC_APP_URL;
const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
if (!token || !base || !liffId)
  throw new Error(
    'need LINE_MESSAGING_CHANNEL_ACCESS_TOKEN + NEXT_PUBLIC_APP_URL + NEXT_PUBLIC_LIFF_ID',
  );

const imagePath = process.argv[2];
const oldRichMenuId = process.argv[3];
if (!imagePath) throw new Error('usage: tsx scripts/setup-admin-rich-menu.ts <image.png> [old-richmenu-id]');
if (!existsSync(imagePath)) throw new Error(`image file not found: ${imagePath}`);

const client = new messagingApi.MessagingApiClient({ channelAccessToken: token });
const blobClient = new messagingApi.MessagingApiBlobClient({ channelAccessToken: token });

const funnel = (state: string) =>
  `https://liff.line.me/${liffId}?liff.state=${encodeURIComponent(state)}`;

const W = 2500,
  H = 1686,
  COL = Math.floor(W / 3);
const { richMenuId } = await client.createRichMenu({
  size: { width: W, height: H },
  selected: true,
  name: 'koolman-admin-v2',
  chatBarText: 'เมนูแอดมิน',
  areas: [
    { bounds: { x: 0, y: 0, width: COL, height: H }, action: { type: 'uri', uri: funnel('?dest=admin-inbox') } },
    { bounds: { x: COL, y: 0, width: COL, height: H }, action: { type: 'uri', uri: funnel('?dest=admin-advance-slip') } },
    { bounds: { x: COL * 2, y: 0, width: W - COL * 2, height: H }, action: { type: 'uri', uri: `${base}/admin` } },
  ],
});

const buf = readFileSync(imagePath);
await blobClient.setRichMenuImage(
  richMenuId,
  new Blob([buf], { type: imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg' }),
);
console.log('ADMIN_RICH_MENU_ID=', richMenuId);

// ── Optional rotation ──────────────────────────────────────────────────
if (oldRichMenuId) {
  if (process.env.DATABASE_URL) {
    // Lazy import keeps the no-rotation path free of a DB connection.
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    // Paired users holding an active admin-tier assignment — the same
    // population the pairing flow links menus for.
    const rows = await prisma.$queryRaw<{ lineUserId: string }[]>`
      SELECT u."lineUserId" FROM "User" u
      WHERE u."lineUserId" IS NOT NULL AND u."archivedAt" IS NULL
        AND EXISTS (
          SELECT 1 FROM "UserRoleAssignment" a
          JOIN "RoleDefinition" r ON r.id = a."roleId"
          WHERE a."userId" = u.id AND r."archivedAt" IS NULL
            AND (r."isSuperadmin" = true OR 'liff.admin' = ANY (r.permissions))
        )`;
    await prisma.$disconnect();
    for (const { lineUserId } of rows) {
      await client.linkRichMenuIdToUser(lineUserId, richMenuId);
      console.log('relinked', lineUserId);
    }
  } else {
    console.warn('DATABASE_URL not set — skipped relinking paired admins (unpair/re-pair manually)');
  }
  await client.deleteRichMenu(oldRichMenuId);
  console.log('deleted old menu', oldRichMenuId);
}
