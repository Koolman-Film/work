/**
 * Per-user admin rich menu link/unlink.
 *
 * The menu object itself is created once by scripts/setup-admin-rich-menu.ts
 * (OA-Manager menus CANNOT be linked per-user via API). Its id lives in
 * ADMIN_RICH_MENU_ID. Both helpers are best-effort: a rich-menu failure
 * must never break pairing/unpairing — they log and return.
 */

import { getLineMessagingClient } from './messaging-client';

export async function linkAdminRichMenu(lineUserId: string): Promise<void> {
  const richMenuId = process.env.ADMIN_RICH_MENU_ID;
  if (!richMenuId) {
    console.warn('[rich-menu] ADMIN_RICH_MENU_ID not set — skipping link');
    return;
  }
  try {
    await getLineMessagingClient().linkRichMenuIdToUser(lineUserId, richMenuId);
  } catch (err) {
    console.error('[rich-menu] link failed (non-fatal)', { lineUserId, err: String(err) });
  }
}

export async function unlinkAdminRichMenu(lineUserId: string): Promise<void> {
  try {
    await getLineMessagingClient().unlinkRichMenuIdFromUser(lineUserId);
  } catch (err) {
    console.error('[rich-menu] unlink failed (non-fatal)', { lineUserId, err: String(err) });
  }
}
