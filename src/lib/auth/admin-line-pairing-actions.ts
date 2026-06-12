'use server';

/**
 * Admin self-serve LINE pairing actions (called from /admin/settings/line).
 *
 * - createMyLinePairingLink: mints a single-use, 1-hour `admin-pair` JWT for
 *   the caller's own User row and returns the LIFF URL to open in LINE.
 *   Re-minting overwrites the previous token (old links die instantly).
 * - unpairMyLine: clears the binding + best-effort unlinks the admin rich menu.
 *
 * Both gate on requireRole(['Admin']) — Superadmin auto-elevates.
 */

import { auditLog } from '@/lib/audit/log';
import { requireRole } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';
import { appBaseUrl } from '@/lib/line/flex-templates';
import { unlinkAdminRichMenu } from '@/lib/line/rich-menu';
import { mintAdminPairingToken } from '@/lib/pairing/token';

/** Mint (or re-mint) the caller's own single-use LINE pairing link. */
export async function createMyLinePairingLink(): Promise<
  { ok: true; url: string; expiresAt: string } | { ok: false; message: string }
> {
  const { user } = await requireRole(['Admin']);
  if (user.lineUserId) {
    return { ok: false, message: 'บัญชีนี้เชื่อมต่อ LINE แล้ว' };
  }

  const { token, expiresAt } = await mintAdminPairingToken(user.id);

  // Re-check + write atomically: a pairing completing between the requireRole
  // read above and this write must not get its lineUserId binding clobbered by
  // a fresh invite token (TOCTOU).
  const txResult = await prisma.$transaction(async (tx) => {
    const fresh = await tx.user.findUnique({
      where: { id: user.id },
      select: { lineUserId: true },
    });
    if (fresh?.lineUserId) {
      return { kind: 'already-paired' as const };
    }
    await tx.user.update({
      where: { id: user.id },
      data: { lineInviteToken: token, lineInviteExpiresAt: expiresAt },
    });
    return { kind: 'ok' as const };
  });

  if (txResult.kind === 'already-paired') {
    return { ok: false, message: 'บัญชีนี้เชื่อมต่อ LINE แล้ว' };
  }

  auditLog({
    actorId: user.id,
    action: 'user.admin-line-invite',
    entityType: 'User',
    entityId: user.id,
    after: { expiresAt: expiresAt.toISOString() },
  });

  return {
    ok: true,
    url: `${appBaseUrl()}/liff/pair-admin/${token}`,
    expiresAt: expiresAt.toISOString(),
  };
}

/** Unpair the caller's own LINE account (clears binding + rich menu). */
export async function unpairMyLine(): Promise<{ ok: true } | { ok: false; message: string }> {
  const { user } = await requireRole(['Admin']);
  if (!user.lineUserId) {
    return { ok: false, message: 'ยังไม่ได้เชื่อมต่อ LINE' };
  }

  await unlinkAdminRichMenu(user.lineUserId); // best-effort inside (never throws)
  await prisma.user.update({
    where: { id: user.id },
    data: { lineUserId: null, lineInviteToken: null, lineInviteExpiresAt: null },
  });

  auditLog({
    actorId: user.id,
    action: 'user.admin-line-unlink',
    entityType: 'User',
    entityId: user.id,
    before: { lineUserId: user.lineUserId },
  });

  return { ok: true };
}
