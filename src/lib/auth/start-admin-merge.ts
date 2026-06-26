'use server';

/**
 * startAdminMerge — issue a single-use merge token + QR for a pure-admin
 * (email) session so they can scan with LINE and unify their identity.
 *
 * Only a pure admin (User with no linked Employee row) may call this.
 * The employee check is re-fetched from the DB after requireRole to close
 * the TOCTOU window.
 */

import QRCode from 'qrcode';
import { ADMIN_LINE_LINK_ENABLED } from '@/lib/auth/admin-line-feature';
import { requireRole } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';
import { appBaseUrl } from '@/lib/line/flex-templates';
import { mintMergeToken } from '@/lib/pairing/token';

export async function startAdminMerge(): Promise<
  { ok: true; url: string; qrDataUrl: string; expiresAt: Date } | { ok: false; message: string }
> {
  const { user } = await requireRole(['Admin']);
  if (!ADMIN_LINE_LINK_ENABLED) {
    return { ok: false, message: 'ฟีเจอร์เชื่อมบัญชีถูกปิดใช้งานชั่วคราว' };
  }

  // requireRole returns a stripped User; re-fetch the employee relation to
  // guarantee we are dealing with a pure admin (no Employee row).
  const fresh = await prisma.user.findUnique({
    where: { id: user.id },
    select: { employee: { select: { id: true } } },
  });
  if (fresh?.employee) {
    return { ok: false, message: 'บัญชีนี้เป็นพนักงานอยู่แล้ว ไม่จำเป็นต้องเชื่อมบัญชี' };
  }

  const { token, expiresAt } = await mintMergeToken(user.id);

  await prisma.user.update({
    where: { id: user.id },
    data: { mergeToken: token, mergeTokenExpiresAt: expiresAt },
  });

  // Merge MUST run inside the LIFF browser (needs LINE ID token), so we use
  // liff.line.me + liff.state — same pattern as createMyLinePairingLink.
  // The /liff/merge endpoint unwraps ?merge= client-side after liff.init().
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  const url = liffId
    ? `https://liff.line.me/${liffId}?liff.state=${encodeURIComponent(`?merge=${token}`)}`
    : `${appBaseUrl()}/liff/merge/${token}`; // dev fallback when LIFF id unset

  // QR for the desktop-admin case: scan with phone's LINE scanner.
  const qrDataUrl = await QRCode.toDataURL(url, {
    width: 256,
    margin: 2,
    errorCorrectionLevel: 'M',
  });

  return { ok: true, url, qrDataUrl, expiresAt };
}

export async function dismissMergePrompt(): Promise<void> {
  const { user } = await requireRole(['Admin']);
  await prisma.user.update({
    where: { id: user.id },
    data: { mergePromptDismissedAt: new Date() },
  });
}
