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

import QRCode from 'qrcode';
import { auditLog } from '@/lib/audit/log';
import { ADMIN_LINE_LINK_ENABLED } from '@/lib/auth/admin-line-feature';
import { requireRole } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';
import { appBaseUrl } from '@/lib/line/flex-templates';
import { unlinkAdminRichMenu } from '@/lib/line/rich-menu';
import { mintAdminPairingToken } from '@/lib/pairing/token';

/** Mint (or re-mint) the caller's own single-use LINE pairing link. */
export async function createMyLinePairingLink(): Promise<
  { ok: true; url: string; qrDataUrl: string; expiresAt: string } | { ok: false; message: string }
> {
  const { user } = await requireRole(['Admin']);
  if (!ADMIN_LINE_LINK_ENABLED) {
    return { ok: false, message: 'ฟีเจอร์เชื่อมต่อ LINE สำหรับผู้ดูแลถูกปิดใช้งานชั่วคราว' };
  }
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

  // Pairing MUST run inside the LIFF browser (ID token), so the link uses
  // liff.line.me + liff.state — the only mechanism LINE reliably honors
  // (plain app URLs open as a normal webpage with no LIFF context, and
  // both raw query strings and path segments get stripped by some LINE
  // versions; see the history in src/app/i/[token]/page.tsx). The
  // /liff/pair endpoint unwraps ?pairAdmin= client-side after liff.init().
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  const url = liffId
    ? `https://liff.line.me/${liffId}?liff.state=${encodeURIComponent(`?pairAdmin=${token}`)}`
    : `${appBaseUrl()}/liff/pair-admin/${token}`; // dev fallback when LIFF id unset

  // QR for the desktop-admin case: scan with the phone's LINE scanner
  // (or camera) instead of sending the link to yourself. Same settings
  // as the employee pairing card.
  const qrDataUrl = await QRCode.toDataURL(url, {
    width: 256,
    margin: 2,
    errorCorrectionLevel: 'M',
  });

  return {
    ok: true,
    url,
    qrDataUrl,
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
