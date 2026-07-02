'use server';

/**
 * `linkLineToEmployee()` — Server Action invoked from /liff/pair.
 *
 * Pre-conditions (all must hold or the action throws):
 *   - Caller has a valid Supabase session (created moments earlier via
 *     `signInWithIdToken({ provider: 'custom:line' })`). We use that session
 *     to learn `authUserId` and the LINE `sub`.
 *   - The pairing JWT verifies (`verifyPairingToken` — issuer, audience,
 *     scope, expiry, signature).
 *   - `Employee.inviteToken === incomingToken` (single-use guard — the
 *     admin's "regenerate link" action nulls the old one, so a copy from
 *     an old email never works).
 *   - Employee is not archived and has no `User.lineUserId` already bound.
 *   - This `authUserId` is not already linked to a different Employee
 *     (a LINE account binds to at most one Employee).
 *
 * On success:
 *   - Writes/updates the `User` row keyed by `authUserId` to:
 *       { role: 'Staff', lineUserId, employeeId, displayName }
 *   - Nulls `employee.inviteToken` / `inviteExpiresAt` (consume single-use).
 *   - Writes an audit row (`employee.line-link`).
 *
 * Everything happens in a single Prisma transaction so partial failure
 * leaves no inconsistent state (employee bound but audit row missing, etc).
 *
 * Returns a small shape so the LIFF client can show a personalized success
 * page without a second round-trip.
 */

import { Prisma } from '@prisma/client';
import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { auditLogTx } from '@/lib/audit/log';
import { prisma } from '@/lib/db/prisma';
import { syncRichMenuForUser } from '@/lib/line/rich-menu';
import { verifyPairingToken } from '@/lib/pairing/token';
import { createClient } from '@/lib/supabase/server';

export type LinkLineResult =
  | { ok: true; employee: { id: string; firstName: string; lastName: string } }
  | {
      ok: false;
      code:
        | 'no-session'
        | 'invalid-token'
        | 'revoked-or-consumed'
        | 'expired'
        | 'employee-archived'
        | 'already-linked'
        | 'line-account-in-use';
      message: string;
    };

export async function linkLineToEmployee(input: { pairingToken: string }): Promise<LinkLineResult> {
  // Worker-facing strings localized to the requester's locale (NEXT_LOCALE
  // cookie, or Accept-Language pre-login); `code` stays the stable discriminant.
  const t = await getTranslations('pair');

  // 1. Confirm caller has a Supabase session (LIFF just created one).
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    return {
      ok: false,
      code: 'no-session',
      message: t('error.noSession'),
    };
  }

  // 2. Cryptographic verify of the pairing JWT. This is necessary but not
  //    sufficient — the DB-side single-use check is the real authority.
  let employeeId: string;
  try {
    const payload = await verifyPairingToken(input.pairingToken);
    employeeId = payload.employeeId;
  } catch {
    return {
      ok: false,
      code: 'invalid-token',
      message: t('error.linkInvalidTampered'),
    };
  }

  // 3. Pull the LINE sub. We prefer the identities array (cryptographically
  //    bound to the OIDC token Supabase verified); fall back to authUser.id.
  const lineUserId =
    (authUser.identities ?? []).find((i) => i.provider === 'custom:line')?.id ?? authUser.id;

  // 4. Capture request context for the audit row before we lose access to it
  //    inside the transaction callback.
  const headerList = await headers();
  const ip =
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headerList.get('x-real-ip') ??
    undefined;
  const userAgent = headerList.get('user-agent') ?? undefined;

  // 5. The atomic bind. Everything inside this $transaction either all
  //    commits or all rolls back.
  try {
    const result = await prisma.$transaction(async (tx) => {
      const emp = await tx.employee.findUnique({
        where: { id: employeeId },
        include: { user: true },
      });

      if (!emp) {
        return { kind: 'err' as const, code: 'invalid-token' as const };
      }

      if (emp.archivedAt) {
        return { kind: 'err' as const, code: 'employee-archived' as const };
      }

      // Single-use: token must match the one Admin last issued, AND must
      // still be present (null means already consumed or revoked).
      if (!emp.inviteToken || emp.inviteToken !== input.pairingToken) {
        return { kind: 'err' as const, code: 'revoked-or-consumed' as const };
      }

      if (emp.inviteExpiresAt && emp.inviteExpiresAt.getTime() < Date.now()) {
        return { kind: 'err' as const, code: 'expired' as const };
      }

      // If a User already exists on this Employee with a lineUserId, the
      // employee is already paired. Don't quietly overwrite.
      if (emp.user.lineUserId) {
        return { kind: 'err' as const, code: 'already-linked' as const };
      }

      // Cross-row check: is this Supabase authUserId already bound to a
      // DIFFERENT User row? If so, refuse — `authUserId` is @unique and
      // attempting to write it on this Employee's User would trigger
      // Prisma P2002 with a confusing user-facing message.
      //
      // Two flavors of collision both surface here:
      //
      //   (a) The most common — same LINE account previously paired with
      //       another Employee. existingForAuthUser.employee is that other
      //       Employee row.
      //
      //   (b) The "session leak" case — usually happens during admin
      //       testing. LINE's webview shares cookies with the system
      //       browser for the same domain, so a LIFF page opened while
      //       you're logged in as Admin/Superadmin sees YOUR admin Supabase
      //       cookie. liffBootstrap's getSession() fast-path returns
      //       that session, skips LINE OIDC, and we end up trying to
      //       bind the Employee's User to the admin's authUserId.
      //       existingForAuthUser exists but has no Employee back-relation
      //       (admins / owners have role≠Employee + no Employee row).
      //
      // Either way, refuse. The user-facing message hints at the fix:
      // "log out of admin / use a different browser / use a different
      // LINE account."
      const existingForAuthUser = await tx.user.findUnique({
        where: { authUserId: authUser.id },
        select: { id: true, employee: { select: { id: true } } },
      });

      if (existingForAuthUser && existingForAuthUser.id !== emp.user.id) {
        return { kind: 'err' as const, code: 'line-account-in-use' as const };
      }

      // Update the existing User row that the Employee already points to
      // (seed/CRUD creates it without authUserId/lineUserId). We bind the
      // identity fields here. Role stays 'Staff' — set at creation.
      const updatedUser = await tx.user.update({
        where: { id: emp.user.id },
        data: {
          authUserId: authUser.id,
          lineUserId,
        },
      });

      // Consume the single-use token.
      await tx.employee.update({
        where: { id: emp.id },
        data: { inviteToken: null, inviteExpiresAt: null },
      });

      await auditLogTx(tx, {
        actorId: updatedUser.id,
        action: 'employee.line-link',
        entityType: 'Employee',
        entityId: emp.id,
        before: { lineUserId: null, authUserId: null },
        after: { lineUserId, authUserId: authUser.id },
        metadata: { ip, userAgent, source: 'liff' },
      });

      return {
        kind: 'ok' as const,
        userId: updatedUser.id,
        employee: { id: emp.id, firstName: emp.firstName, lastName: emp.lastName },
      };
    });

    if (result.kind === 'ok') {
      // Best-effort: employee-only → employee menu; employee who is also an
      // admin → combined. All-dynamic (no OA default). Never throws.
      await syncRichMenuForUser(result.userId);
      return { ok: true, employee: result.employee };
    }

    const messages: Record<Exclude<LinkLineResult & { ok: false }, never>['code'], string> = {
      'no-session': t('error.noSession'),
      'invalid-token': t('error.linkInvalid'),
      'revoked-or-consumed': t('error.linkUsed'),
      expired: t('error.linkExpired'),
      'employee-archived': t('error.employeeArchived'),
      'already-linked': t('error.alreadyLinked'),
      'line-account-in-use': t('error.accountInUseAdmin'),
    };
    return { ok: false, code: result.code, message: messages[result.code] };
  } catch (err) {
    // Diagnostic logging — capture the inputs that led here so the Vercel
    // log entry is self-contained. The catch fires for any uncaught
    // exception inside the $transaction; common shapes:
    //   - Prisma P2002 (unique constraint): a User row already has this
    //     authUserId or lineUserId. Usually means this LINE account was
    //     previously paired with a DIFFERENT employee whose row was
    //     manually deleted leaving an orphan, OR there's a race between
    //     two concurrent pair attempts (rare).
    //   - Prisma P2025 (not found): the Employee row vanished between
    //     the upper checks and the .update call — concurrent delete.
    //   - Connection pooler quirks: rare, but interactive transactions
    //     occasionally fail on Supabase Transaction Pooler under load.
    console.error('[link-line-to-employee] tx failed', {
      employeeId,
      authUserId: authUser.id,
      lineUserId,
      errorName: err instanceof Error ? err.name : 'unknown',
      errorMessage: err instanceof Error ? err.message : String(err),
      ...(err instanceof Prisma.PrismaClientKnownRequestError && {
        prismaCode: err.code,
        prismaMeta: err.meta,
      }),
    });

    // Decode Prisma's "known" errors into actionable messages.
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') {
        // Unique constraint violation. The .meta.target tells which field.
        const target = String(err.meta?.target ?? '').toLowerCase();
        if (target.includes('lineuserid')) {
          return {
            ok: false,
            code: 'line-account-in-use',
            message: t('error.lineInUse'),
          };
        }
        if (target.includes('authuserid')) {
          return {
            ok: false,
            code: 'line-account-in-use',
            message: t('error.accountInUse'),
          };
        }
      }
      if (err.code === 'P2025') {
        return {
          ok: false,
          code: 'invalid-token',
          message: t('error.employeeNotFound'),
        };
      }
    }

    return {
      ok: false,
      code: 'invalid-token',
      message: t('error.serverError'),
    };
  }
}
