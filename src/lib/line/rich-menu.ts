/**
 * Per-user admin rich menu link/unlink.
 *
 * The menu object itself is created once by scripts/setup-admin-rich-menu.ts
 * (OA-Manager menus CANNOT be linked per-user via API). Its id lives in
 * ADMIN_RICH_MENU_ID. Both helpers are best-effort: a rich-menu failure
 * must never break pairing/unpairing — they log and return.
 */

import { computeTier, type TierAssignment } from '@/lib/auth/user-tier';
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

export type MenuTarget = 'combined' | 'admin' | 'none';

/**
 * Pure policy: which rich menu should a user with these capabilities see?
 * Employee-only and "neither" both resolve to 'none' (unlink) — the OA
 * default menu is the employee menu, so we only per-user-link the two
 * override menus (admin, combined).
 */
export function computeMenuTarget(caps: { hasEmployee: boolean; hasAdmin: boolean }): MenuTarget {
  if (caps.hasAdmin && caps.hasEmployee) return 'combined';
  if (caps.hasAdmin) return 'admin';
  return 'none';
}

/** Pure: derive capability flags from a loaded user's relations. */
export function resolveCapabilities(user: {
  employee: { id: string } | null;
  roleAssignments: ReadonlyArray<TierAssignment>;
}): { hasEmployee: boolean; hasAdmin: boolean } {
  const tier = computeTier(user.roleAssignments);
  return {
    hasEmployee: user.employee !== null,
    hasAdmin: tier === 'Admin' || tier === 'Superadmin',
  };
}
