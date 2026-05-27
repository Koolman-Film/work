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
 *       { role: 'Employee', lineUserId, employeeId, displayName }
 *   - Nulls `employee.inviteToken` / `inviteExpiresAt` (consume single-use).
 *   - Writes an audit row (`employee.line-link`).
 *
 * Everything happens in a single Prisma transaction so partial failure
 * leaves no inconsistent state (employee bound but audit row missing, etc).
 *
 * Returns a small shape so the LIFF client can show a personalized success
 * page without a second round-trip.
 */

import { headers } from 'next/headers';
import { auditLogTx } from '@/lib/audit/log';
import { prisma } from '@/lib/db/prisma';
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
  // 1. Confirm caller has a Supabase session (LIFF just created one).
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    return {
      ok: false,
      code: 'no-session',
      message: 'No Supabase session — the LINE OIDC sign-in must complete first',
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
      message: 'ลิงก์ไม่ถูกต้องหรือถูกแก้ไข',
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

      // Cross-row check: is this LINE auth user already bound to a
      // DIFFERENT User row? If so, refuse — a LINE account should map to
      // at most one User (and therefore at most one Employee).
      //
      // The schema relation is Employee.userId → User.id, and User has
      // a back-relation `employee Employee?`. So we look up by authUserId
      // and inspect the joined Employee.
      const existingForAuthUser = await tx.user.findUnique({
        where: { authUserId: authUser.id },
        select: { id: true, employee: { select: { id: true } } },
      });

      if (existingForAuthUser?.employee && existingForAuthUser.employee.id !== emp.id) {
        return { kind: 'err' as const, code: 'line-account-in-use' as const };
      }

      // Update the existing User row that the Employee already points to
      // (seed/CRUD creates it without authUserId/lineUserId). We bind the
      // identity fields here. Role stays 'Employee' — set at creation.
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
        employee: { id: emp.id, firstName: emp.firstName, lastName: emp.lastName },
      };
    });

    if (result.kind === 'ok') {
      return { ok: true, employee: result.employee };
    }

    const messages: Record<Exclude<LinkLineResult & { ok: false }, never>['code'], string> = {
      'no-session': 'กรุณาเข้าสู่ระบบใหม่',
      'invalid-token': 'ลิงก์ไม่ถูกต้อง',
      'revoked-or-consumed': 'ลิงก์นี้ใช้ไปแล้วหรือถูกยกเลิก ติดต่อแอดมินเพื่อขอลิงก์ใหม่',
      expired: 'ลิงก์หมดอายุ ติดต่อแอดมินเพื่อขอลิงก์ใหม่',
      'employee-archived': 'บัญชีพนักงานนี้พ้นสภาพแล้ว',
      'already-linked': 'บัญชีนี้เชื่อม LINE เรียบร้อยแล้ว',
      'line-account-in-use': 'บัญชี LINE นี้ถูกใช้กับพนักงานคนอื่นแล้ว',
    };
    return { ok: false, code: result.code, message: messages[result.code] };
  } catch (err) {
    console.error('[link-line-to-employee] tx failed', err);
    return {
      ok: false,
      code: 'invalid-token',
      message: 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง',
    };
  }
}
