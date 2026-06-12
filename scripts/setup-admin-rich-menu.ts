/**
 * One-off: create the ADMIN rich menu + upload its image, print the id.
 * Usage: pnpm tsx scripts/setup-admin-rich-menu.ts ./assets/rich-menu/admin-rich-menu-placeholder.png
 * Env: LINE_MESSAGING_CHANNEL_ACCESS_TOKEN + NEXT_PUBLIC_APP_URL must be set.
 * Then set ADMIN_RICH_MENU_ID=<printed id> in the deploy env.
 * Image: 2500x1686 px, three equal columns, JPEG/PNG <= 1MB.
 */
import { existsSync, readFileSync } from 'node:fs';
import { messagingApi } from '@line/bot-sdk';

const token = process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN;
const base = process.env.NEXT_PUBLIC_APP_URL;
if (!token || !base) throw new Error('need LINE_MESSAGING_CHANNEL_ACCESS_TOKEN + NEXT_PUBLIC_APP_URL');

const imagePath = process.argv[2];
if (!imagePath) throw new Error('usage: tsx scripts/setup-admin-rich-menu.ts <image.png>');
if (!existsSync(imagePath)) throw new Error(`image file not found: ${imagePath}`);

const client = new messagingApi.MessagingApiClient({ channelAccessToken: token });
const blobClient = new messagingApi.MessagingApiBlobClient({ channelAccessToken: token });

const W = 2500, H = 1686, COL = Math.floor(W / 3);
const { richMenuId } = await client.createRichMenu({
  size: { width: W, height: H },
  selected: true,
  name: 'koolman-admin-v1',
  chatBarText: 'เมนูแอดมิน',
  areas: [
    { bounds: { x: 0, y: 0, width: COL, height: H }, action: { type: 'uri', uri: `${base}/liff/admin/inbox` } },
    { bounds: { x: COL, y: 0, width: COL, height: H }, action: { type: 'uri', uri: `${base}/liff/admin/advance?filter=awaiting-slip` } },
    { bounds: { x: COL * 2, y: 0, width: W - COL * 2, height: H }, action: { type: 'uri', uri: `${base}/admin` } },
  ],
});

const buf = readFileSync(imagePath);
await blobClient.setRichMenuImage(richMenuId, new Blob([buf], { type: imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg' }));
console.log('ADMIN_RICH_MENU_ID=', richMenuId);
