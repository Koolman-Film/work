/**
 * One-off: create the COMBINED (admin + employee) rich menu, upload its
 * image, print the id.
 * Usage: pnpm tsx scripts/setup-combined-rich-menu.ts ./assets/rich-menu/combined.png [old-richmenu-id]
 * Env: LINE_MESSAGING_CHANNEL_ACCESS_TOKEN + NEXT_PUBLIC_APP_URL + NEXT_PUBLIC_LIFF_ID.
 * Then set COMBINED_RICH_MENU_ID=<printed id> in the deploy env.
 *
 * Image: 2500x1686 px, JPEG/PNG <= 1MB. The areas below are a 2x3 default —
 * adjust bounds + dest values to match the designed image and the /liff/pair
 * dispatcher's dest keys.
 *
 * If [old-richmenu-id] is given, every COMBINED-eligible user (lineUserId +
 * admin role + Employee record) is re-linked to the new menu and the old menu
 * deleted (rotation — LINE rich menus are immutable).
 */
import { existsSync, readFileSync } from 'node:fs';
import { messagingApi } from '@line/bot-sdk';

const token = process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN;
const base = process.env.NEXT_PUBLIC_APP_URL;
const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
if (!token || !base || !liffId)
  throw new Error('need LINE_MESSAGING_CHANNEL_ACCESS_TOKEN + NEXT_PUBLIC_APP_URL + NEXT_PUBLIC_LIFF_ID');

const imagePath = process.argv[2];
const oldRichMenuId = process.argv[3];
if (!imagePath) throw new Error('usage: tsx scripts/setup-combined-rich-menu.ts <image.png> [old-richmenu-id]');
if (!existsSync(imagePath)) throw new Error(`image file not found: ${imagePath}`);

const client = new messagingApi.MessagingApiClient({ channelAccessToken: token });
const blobClient = new messagingApi.MessagingApiBlobClient({ channelAccessToken: token });

const funnel = (state: string) =>
  `https://liff.line.me/${liffId}?liff.state=${encodeURIComponent(state)}`;

const W = 2500,
  H = 1686,
  COL = Math.floor(W / 3),
  ROW = Math.floor(H / 2);

const { richMenuId } = await client.createRichMenu({
  size: { width: W, height: H },
  selected: true,
  name: 'koolman-combined-v1',
  chatBarText: 'เมนูแอดมิน+พนักงาน',
  areas: [
    // Top row — employee functions
    { bounds: { x: 0, y: 0, width: COL, height: ROW }, action: { type: 'uri', uri: funnel('?dest=check-in') } },
    { bounds: { x: COL, y: 0, width: COL, height: ROW }, action: { type: 'uri', uri: funnel('?dest=leave') } },
    { bounds: { x: COL * 2, y: 0, width: W - COL * 2, height: ROW }, action: { type: 'uri', uri: `${base}/liff/home` } },
    // Bottom row — admin functions
    { bounds: { x: 0, y: ROW, width: COL, height: H - ROW }, action: { type: 'uri', uri: funnel('?dest=admin-inbox') } },
    { bounds: { x: COL, y: ROW, width: COL, height: H - ROW }, action: { type: 'uri', uri: funnel('?dest=admin-advance-slip') } },
    { bounds: { x: COL * 2, y: ROW, width: W - COL * 2, height: H - ROW }, action: { type: 'uri', uri: `${base}/admin` } },
  ],
});

const buf = readFileSync(imagePath);
await blobClient.setRichMenuImage(
  richMenuId,
  new Blob([buf], { type: imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg' }),
);
console.log('COMBINED_RICH_MENU_ID=', richMenuId);

// ── Optional rotation ──────────────────────────────────────────────────
if (oldRichMenuId) {
  if (process.env.DATABASE_URL) {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    // Combined-eligible: paired (lineUserId) AND admin-tier AND has Employee.
    const rows = await prisma.$queryRaw<{ lineUserId: string }[]>`
      SELECT u."lineUserId" FROM "User" u
      WHERE u."lineUserId" IS NOT NULL AND u."archivedAt" IS NULL
        AND EXISTS (SELECT 1 FROM "Employee" e WHERE e."userId" = u.id)
        -- Mirrors the runtime decision core (computeTier): key-based 'admin'. The admin script uses a permission-based predicate ('liff.admin'), so the two rotations may select slightly different populations.
        AND EXISTS (
          SELECT 1 FROM "UserRoleAssignment" a
          JOIN "RoleDefinition" r ON r.id = a."roleId"
          WHERE a."userId" = u.id AND r."archivedAt" IS NULL
            AND (r."isSuperadmin" = true OR r.key = 'admin'))`;
    await prisma.$disconnect();
    for (const { lineUserId } of rows) {
      await client.linkRichMenuIdToUser(lineUserId, richMenuId);
      console.log('relinked', lineUserId);
    }
  } else {
    console.warn('DATABASE_URL not set — skipped relinking combined-eligible users');
  }
  await client.deleteRichMenu(oldRichMenuId);
  console.log('deleted old menu', oldRichMenuId);
}
