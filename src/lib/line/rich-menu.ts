/**
 * Capability-driven, all-dynamic per-user rich menus.
 *
 * There is NO OA default menu (removed from the LINE console) — every menu is
 * linked per-user by capability: employee → employee menu, admin → admin menu,
 * both → combined menu, neither/archived → unlink (blank bar). The three menu
 * objects are created once by scripts/setup-rich-menus.ts; their ids live in
 * EMPLOYEE_RICH_MENU_ID / ADMIN_RICH_MENU_ID / COMBINED_RICH_MENU_ID.
 *
 * Everything here is best-effort: a rich-menu API failure must never break the
 * pairing / merge / role-change / archive that triggered it — we log and return.
 */

import { computeTier, type TierAssignment } from '@/lib/auth/user-tier';
import { prisma } from '@/lib/db/prisma';
import { getLineMessagingClient } from './messaging-client';

export async function unlinkAdminRichMenu(lineUserId: string): Promise<void> {
  try {
    await getLineMessagingClient().unlinkRichMenuIdFromUser(lineUserId);
  } catch (err) {
    console.error('[rich-menu] unlink failed (non-fatal)', { lineUserId, err: String(err) });
  }
}

export type MenuTarget = 'combined' | 'admin' | 'employee' | 'none';

/** The env var holding the LINE rich-menu id for each non-'none' target. */
export function menuIdForTarget(target: Exclude<MenuTarget, 'none'>): string | undefined {
  switch (target) {
    case 'combined':
      return process.env.COMBINED_RICH_MENU_ID;
    case 'admin':
      return process.env.ADMIN_RICH_MENU_ID;
    case 'employee':
      return process.env.EMPLOYEE_RICH_MENU_ID;
  }
}

/**
 * Pure policy: which rich menu should a user with these capabilities see?
 *
 * Every menu is per-user-linked (all-dynamic) — there is NO OA default menu
 * (removed from the LINE console), so an employee-only user must be explicitly
 * linked to the employee menu, and a user with no capabilities (archived, or a
 * pure admin who lost their role) gets 'none' → a blank menu bar.
 */
export function computeMenuTarget(caps: { hasEmployee: boolean; hasAdmin: boolean }): MenuTarget {
  if (caps.hasAdmin && caps.hasEmployee) return 'combined';
  if (caps.hasAdmin) return 'admin';
  if (caps.hasEmployee) return 'employee';
  return 'none';
}

/**
 * Pure: derive capability flags from a loaded user's relations. An archived
 * User has no capabilities — it resolves to 'none' (unlink), so archiving a
 * user strips their menu regardless of the roles still attached (the direct
 * fix for the 2026-07-01 archive incident).
 */
export function resolveCapabilities(user: {
  archivedAt: Date | null;
  employee: { id: string } | null;
  roleAssignments: ReadonlyArray<TierAssignment>;
}): { hasEmployee: boolean; hasAdmin: boolean } {
  if (user.archivedAt !== null) return { hasEmployee: false, hasAdmin: false };
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
    archivedAt: Date | null;
    employee: { id: string } | null;
    roleAssignments: ReadonlyArray<TierAssignment>;
  } | null;
  try {
    user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        lineUserId: true,
        archivedAt: true,
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
    const richMenuId = menuIdForTarget(target);
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
