/**
 * One-off: create a Koolman rich menu object on LINE, upload its image, print
 * the env id to set. Run once per menu type (employee / admin / combined).
 *
 * Usage:
 *   dotenv -e .env.production -- tsx scripts/setup-rich-menus.ts employee ./assets/rich-menu/final/menu-employee.png
 *   dotenv -e .env.production -- tsx scripts/setup-rich-menus.ts admin    ./assets/rich-menu/final/menu-admin.png
 *   dotenv -e .env.production -- tsx scripts/setup-rich-menus.ts combined ./assets/rich-menu/final/menu-combined.png
 * Then set the printed EMPLOYEE_/ADMIN_/COMBINED_RICH_MENU_ID in the deploy env.
 *
 * Env: LINE_MESSAGING_CHANNEL_ACCESS_TOKEN + NEXT_PUBLIC_APP_URL + NEXT_PUBLIC_LIFF_ID.
 *
 * ALL-DYNAMIC MODEL: every menu is created with `selected: false` — there is NO
 * OA default menu. Menus are linked per-user by capability (scripts/sync-rich-menus.ts
 * and the app's syncRichMenuForUser). Do NOT set a default menu in the console.
 *
 * ROTATION: menus are immutable, so an art/area change means a NEW menu object.
 * To rotate: create the new menu here → update the *_RICH_MENU_ID env → run
 * `scripts/sync-rich-menus.ts --apply` (relinks everyone by capability) →
 * delete the old menu object in the LINE console. The sweep is the single
 * relink path, so this script no longer relinks users itself.
 *
 * Image: 2500x1686 px, PNG/JPEG <= 1MB. Tap areas funnel through liff.line.me
 * (?liff.state=?dest=...) — never direct app URLs: LINE's plain in-app browser
 * has a separate cookie jar from the LIFF browser, so /liff/pair dispatches
 * ?dest= (see DEST_MAP in pair-client.tsx) to the right page with a live session.
 */
import { existsSync, readFileSync } from 'node:fs';
import { messagingApi } from '@line/bot-sdk';

const token = process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN;
const base = process.env.NEXT_PUBLIC_APP_URL;
const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
if (!token || !base || !liffId)
  throw new Error('need LINE_MESSAGING_CHANNEL_ACCESS_TOKEN + NEXT_PUBLIC_APP_URL + NEXT_PUBLIC_LIFF_ID');

const client = new messagingApi.MessagingApiClient({ channelAccessToken: token });
const blobClient = new messagingApi.MessagingApiBlobClient({ channelAccessToken: token });

const funnel = (state: string) =>
  `https://liff.line.me/${liffId}?liff.state=${encodeURIComponent(state)}`;

const W = 2500;
const H = 1686;
const COL = Math.floor(W / 3);
const ROW = Math.floor(H / 2);
const uri = (u: string) => ({ type: 'uri' as const, uri: u });

type Spec = { name: string; chatBarText: string; areas: messagingApi.RichMenuArea[] };

// Area geometry mirrors the final artwork in assets/rich-menu/final/*.png.
const SPECS: Record<'employee' | 'admin' | 'combined', Spec> = {
  // Employee: full-width check-in banner on top, 3 columns below.
  employee: {
    name: 'koolman-employee-v1',
    chatBarText: 'เมนูพนักงาน',
    areas: [
      { bounds: { x: 0, y: 0, width: W, height: ROW }, action: uri(funnel('?dest=check-in')) },
      { bounds: { x: 0, y: ROW, width: COL, height: H - ROW }, action: uri(funnel('?dest=leave')) },
      { bounds: { x: COL, y: ROW, width: COL, height: H - ROW }, action: uri(funnel('?dest=advance')) },
      { bounds: { x: COL * 2, y: ROW, width: W - COL * 2, height: H - ROW }, action: uri(funnel('?dest=calendar')) },
    ],
  },
  // Admin: 3 equal columns — inbox, advance-slip, admin web.
  admin: {
    name: 'koolman-admin-v2',
    chatBarText: 'เมนูแอดมิน',
    areas: [
      { bounds: { x: 0, y: 0, width: COL, height: H }, action: uri(funnel('?dest=admin-inbox')) },
      { bounds: { x: COL, y: 0, width: COL, height: H }, action: uri(funnel('?dest=admin-advance-slip')) },
      { bounds: { x: COL * 2, y: 0, width: W - COL * 2, height: H }, action: uri(`${base}/admin`) },
    ],
  },
  // Combined: employee row on top, admin row below.
  combined: {
    name: 'koolman-combined-v1',
    chatBarText: 'เมนูแอดมิน+พนักงาน',
    areas: [
      { bounds: { x: 0, y: 0, width: COL, height: ROW }, action: uri(funnel('?dest=check-in')) },
      { bounds: { x: COL, y: 0, width: COL, height: ROW }, action: uri(funnel('?dest=leave')) },
      { bounds: { x: COL * 2, y: 0, width: W - COL * 2, height: ROW }, action: uri(`${base}/liff/home`) },
      { bounds: { x: 0, y: ROW, width: COL, height: H - ROW }, action: uri(funnel('?dest=admin-inbox')) },
      { bounds: { x: COL, y: ROW, width: COL, height: H - ROW }, action: uri(funnel('?dest=admin-advance-slip')) },
      { bounds: { x: COL * 2, y: ROW, width: W - COL * 2, height: H - ROW }, action: uri(`${base}/admin`) },
    ],
  },
};

async function main() {
  const menuType = process.argv[2];
  const image = process.argv[3];
  if (menuType !== 'employee' && menuType !== 'admin' && menuType !== 'combined')
    throw new Error('usage: tsx scripts/setup-rich-menus.ts <employee|admin|combined> <image.png>');
  if (!image || !existsSync(image)) throw new Error(`image file not found: ${image}`);

  const spec = SPECS[menuType];
  const { richMenuId } = await client.createRichMenu({
    size: { width: W, height: H },
    // NEVER selected: the all-dynamic model has no OA default menu.
    selected: false,
    name: spec.name,
    chatBarText: spec.chatBarText,
    areas: spec.areas,
  });

  const buf = readFileSync(image);
  await blobClient.setRichMenuImage(
    richMenuId,
    new Blob([buf], { type: image.endsWith('.png') ? 'image/png' : 'image/jpeg' }),
  );

  const envKey =
    menuType === 'combined'
      ? 'COMBINED_RICH_MENU_ID'
      : menuType === 'admin'
        ? 'ADMIN_RICH_MENU_ID'
        : 'EMPLOYEE_RICH_MENU_ID';
  console.log(`${envKey}=${richMenuId}`);
  console.log(
    'Set this in the deploy env, then run: tsx scripts/sync-rich-menus.ts --apply (backfill/relink).',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
