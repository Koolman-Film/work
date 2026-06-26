/**
 * Per-user admin rich menu link/unlink.
 *
 * The menu object itself is created once by scripts/setup-admin-rich-menu.ts
 * (OA-Manager menus CANNOT be linked per-user via API). Its id lives in
 * ADMIN_RICH_MENU_ID. Both helpers are best-effort: a rich-menu failure
 * must never break pairing/unpairing — they log and return.
 */

import { computeTier, type TierAssignment } from '@/lib/auth/user-tier';
import { prisma } from '@/lib/db/prisma';
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

/**
 * Best-effort: bring a user's per-user rich-menu link in line with their
 * current capabilities. No-op if the user has no LINE bound. Never throws —
 * a LINE failure must not break the pairing / merge / role-change that
 * triggered it.
 */
export async function syncRichMenuForUser(userId: string): Promise<void> {
  let user: {
    lineUserId: string | null;
    employee: { id: string } | null;
    roleAssignments: ReadonlyArray<TierAssignment>;
  } | null;
  try {
    user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        lineUserId: true,
        employee: { select: { id: true } },
        roleAssignments: {
          select: { role: { select: { key: true, isSuperadmin: true, archivedAt: true } } },
        },
      },
    });
  } catch (err) {
    console.error('[rich-menu] sync load failed (non-fatal)', { userId, err: String(err) });
    return;
  }
  if (!user?.lineUserId) return;

  const lineUserId = user.lineUserId;
  const target = computeMenuTarget(resolveCapabilities(user));
  try {
    const client = getLineMessagingClient();
    if (target === 'none') {
      // No env-id guard needed — unlinking takes no menu id.
      await client.unlinkRichMenuIdFromUser(lineUserId);
      return;
    }
    const richMenuId =
      target === 'combined' ? process.env.COMBINED_RICH_MENU_ID : process.env.ADMIN_RICH_MENU_ID;
    if (!richMenuId) {
      console.warn('[rich-menu] menu id env not set — skipping link', { target });
      return;
    }
    await client.linkRichMenuIdToUser(lineUserId, richMenuId);
  } catch (err) {
    console.error('[rich-menu] sync apply failed (non-fatal)', {
      userId,
      target,
      err: String(err),
    });
  }
}
