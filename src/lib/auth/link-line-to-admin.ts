'use server';

/**
 * `linkLineToAdmin()` — Server Action invoked from /liff/pair-admin/[token].
 *
 * Mirrors linkLineToEmployee but binds an ADMIN's own User row to their
 * LINE account. Key differences:
 *   - Token scope is 'admin-pair'; sub is the admin's User.id (not an
 *     Employee.id).
 *   - We only set `lineUserId` — `authUserId` stays bound to the admin's
 *     email auth user. requireRole's LIFF fallback resolves the LINE-minted
 *     session via lineUserId afterwards.
 *   - Target must hold an active admin-tier role assignment (superadmin or
 *     key === 'admin', role not archived).
 *   - Messages are Thai-only (admin panel is intentionally untranslated).
 *
 * After the transaction commits we best-effort link the admin rich menu —
 * rich-menu failure never fails the pairing.
 */

import { Prisma } from '@prisma/client';
import { headers } from 'next/headers';
import { auditLogTx } from '@/lib/audit/log';
import { ADMIN_LINE_LINK_ENABLED } from '@/lib/auth/admin-line-feature';
import { prisma } from '@/lib/db/prisma';
import { linkAdminRichMenu } from '@/lib/line/rich-menu';
import { verifyAdminPairingToken } from '@/lib/pairing/token';
import { createClient } from '@/lib/supabase/server';

export type LinkLineToAdminResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | 'no-session'
        | 'invalid-token'
        | 'revoked-or-consumed'
        | 'expired'
        | 'not-admin'
        | 'line-account-in-use'
        | 'server-error';
      message: string;
    };

const MESSAGES: Record<Exclude<LinkLineToAdminResult, { ok: true }>['code'], string> = {
  'no-session': 'ไม่พบเซสชันการเข้าสู่ระบบ กรุณาเปิดลิงก์นี้ในแอป LINE',
  'invalid-token': 'ลิงก์ไม่ถูกต้องหรือถูกแก้ไข กรุณาสร้างลิงก์ใหม่จากหน้าตั้งค่า',
  'revoked-or-consumed': 'ลิงก์นี้ถูกใช้งานไปแล้วหรือถูกยกเลิก กรุณาสร้างลิงก์ใหม่',
  expired: 'ลิงก์หมดอายุแล้ว กรุณาสร้างลิงก์ใหม่จากหน้าตั้งค่า',
  'not-admin': 'บัญชีนี้ไม่มีสิทธิ์ผู้ดูแลระบบ',
  'line-account-in-use':
    'บัญชี LINE นี้ถูกเชื่อมต่อกับผู้ใช้อื่นแล้ว — บัญชี LINE หนึ่งบัญชีเชื่อมต่อได้กับผู้ใช้เดียวเท่านั้น (แอดมินที่เป็นพนักงานด้วยต้องใช้บัญชี LINE แยกต่างหาก)',
  'server-error': 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง',
};

function err(code: Exclude<LinkLineToAdminResult, { ok: true }>['code']): LinkLineToAdminResult {
  return { ok: false, code, message: MESSAGES[code] };
}

export async function linkLineToAdmin(input: {
  pairingToken: string;
}): Promise<LinkLineToAdminResult> {
  // 1. Confirm the caller has a Supabase session (LIFF just created one —
  //    a fresh LINE-minted auth user is expected here).
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) return err('no-session');

  // 2. Cryptographic verify. Necessary but not sufficient — DB single-use
  //    check below is the real authority.
  let userId: string;
  try {
    const payload = await verifyAdminPairingToken(input.pairingToken);
    userId = payload.userId;
  } catch {
    return err('invalid-token');
  }

  // 3. The LINE sub from the verified OIDC identity. We REQUIRE a real
  //    `custom:line` identity — never fall back to the Supabase auth UUID.
  //    Binding a Supabase UUID into lineUserId would silently break the
  //    requireRole LIFF fallback (which matches on the LINE sub), and unlike
  //    the worker flow admins have no authUserId backup to recover from.
  const lineUserId = (authUser.identities ?? []).find((i) => i.provider === 'custom:line')?.id;
  if (!lineUserId) {
    return { ok: false, code: 'no-session', message: 'ต้องเปิดผ่านแอป LINE เท่านั้น' };
  }

  // 4. Request context for the audit row.
  const headerList = await headers();
  const ip =
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headerList.get('x-real-ip') ??
    undefined;
  const userAgent = headerList.get('user-agent') ?? undefined;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        include: {
          roleAssignments: {
            select: { role: { select: { key: true, isSuperadmin: true, archivedAt: true } } },
          },
        },
      });

      if (!user || user.archivedAt) {
        return { kind: 'err' as const, code: 'invalid-token' as const };
      }

      // Single-use: token must match the one last minted, and still present.
      if (!user.lineInviteToken || user.lineInviteToken !== input.pairingToken) {
        return { kind: 'err' as const, code: 'revoked-or-consumed' as const };
      }
      if (user.lineInviteExpiresAt && user.lineInviteExpiresAt.getTime() < Date.now()) {
        return { kind: 'err' as const, code: 'expired' as const };
      }

      // Must hold an active admin-tier role (superadmin or 'admin').
      const isAdmin = user.roleAssignments.some(
        (a) => a.role.archivedAt === null && (a.role.isSuperadmin || a.role.key === 'admin'),
      );
      if (!isAdmin) {
        return { kind: 'err' as const, code: 'not-admin' as const };
      }

      // Collision: a LINE account binds to at most one User row.
      const existing = await tx.user.findUnique({
        where: { lineUserId },
        select: { id: true },
      });
      if (existing && existing.id !== user.id) {
        return { kind: 'err' as const, code: 'line-account-in-use' as const };
      }

      // Bind lineUserId only — authUserId stays on the admin's email auth
      // user; requireRole's custom:line fallback handles LIFF sessions.
      await tx.user.update({
        where: { id: user.id },
        data: {
          lineUserId,
          lineInviteToken: null,
          lineInviteExpiresAt: null,
        },
      });

      await auditLogTx(tx, {
        actorId: user.id,
        action: 'user.admin-line-link',
        entityType: 'User',
        entityId: user.id,
        before: { lineUserId: null },
        after: { lineUserId },
        metadata: { ip, userAgent, source: 'liff' },
      });

      return { kind: 'ok' as const };
    });

    if (result.kind === 'err') return err(result.code);

    // Best-effort rich menu link after commit — never fails the pairing.
    // Skipped while the admin LINE experience is disabled (ADMIN_LINE_LINK_ENABLED).
    if (ADMIN_LINE_LINK_ENABLED) {
      try {
        await linkAdminRichMenu(lineUserId);
      } catch (richErr) {
        console.error('[link-line-to-admin] rich menu link failed (non-fatal)', {
          lineUserId,
          error: String(richErr),
        });
      }
    }

    return { ok: true };
  } catch (txErr) {
    console.error('[link-line-to-admin] tx failed', {
      userId,
      authUserId: authUser.id,
      lineUserId,
      errorName: txErr instanceof Error ? txErr.name : 'unknown',
      errorMessage: txErr instanceof Error ? txErr.message : String(txErr),
      ...(txErr instanceof Prisma.PrismaClientKnownRequestError && {
        prismaCode: txErr.code,
        prismaMeta: txErr.meta,
      }),
    });

    if (txErr instanceof Prisma.PrismaClientKnownRequestError && txErr.code === 'P2002') {
      const target = String(txErr.meta?.target ?? '').toLowerCase();
      if (target.includes('lineuserid')) {
        return err('line-account-in-use');
      }
    }

    return err('server-error');
  }
}
