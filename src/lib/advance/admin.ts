'use server';

/**
 * Admin-side cash-advance actions: approve + reject.
 *
 * Per docs/v2/build-plan.md §W4: "approve sets status=Approved, receiptUrl,
 * approvedById, approvedAt, isDeducted=false." The receipt URL field is
 * optional in W4d — actual photo upload depends on Supabase Storage which
 * lands in W4-late. For now admin may pass a URL string (e.g., from a
 * Drive link) or skip; the UI surfaces a notice that the upload feature
 * is pending.
 *
 * Why this matters even with receiptUrl optional:
 *   - Audit trail still captures the admin's decision + timestamp.
 *   - When the Storage upload lands, this server action signature doesn't
 *     change — we just start passing receiptUrl reliably.
 */

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { auditLogTx } from '@/lib/audit/log';
import { requireRole } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';
import { sendNotification } from '@/lib/inngest/events';

/** Format Prisma.Decimal as a human-friendly currency string for Flex
 *  Message display. Stays in string form across the Inngest event
 *  boundary so JSON serialisation doesn't drop precision. */
function formatAmount(d: { toString(): string }): string {
  const n = Number(d.toString());
  if (!Number.isFinite(n)) return d.toString();
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export type ApproveAdvanceResult =
  | { ok: true }
  | {
      ok: false;
      code: 'forbidden' | 'not-found' | 'not-pending' | 'db-error';
      message: string;
    };

export type RejectAdvanceResult = ApproveAdvanceResult;

type ApproveInput = {
  cashAdvanceId: string;
  /** Optional in W4d (Storage not wired); will be required in W4-late. */
  receiptUrl?: string;
};

type RejectInput = {
  cashAdvanceId: string;
};

export async function approveCashAdvance(input: ApproveInput): Promise<ApproveAdvanceResult> {
  const { user, authUserId } = await requireRole(['Admin']);

  // Validate receiptUrl shape: if it looks like a Storage key (no http
  // scheme), it MUST start with the admin's own authUserId (because we
  // upload receipts to `{adminAuthUid}/advance-receipts/...`). This
  // protects against a misbehaving client claiming a key in someone
  // else's folder. The Storage RLS already enforces this at upload
  // time, but having the server-side check produces a clean error.
  const rawReceipt = input.receiptUrl?.trim();
  if (rawReceipt && !/^https?:\/\//i.test(rawReceipt)) {
    if (!rawReceipt.startsWith(`${authUserId}/advance-receipts/`)) {
      return {
        ok: false,
        code: 'forbidden',
        message: 'ลิงก์ใบเสร็จไม่ถูกต้อง',
      };
    }
  }

  const headerList = await headers();
  const ip =
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headerList.get('x-real-ip') ??
    undefined;
  const userAgent = headerList.get('user-agent') ?? undefined;

  // Holder object — TS narrows `let foo: T | null = null` assigned in
  // async closures to `never` post-tx. Object mutation is exempt.
  // See src/lib/leave/admin.ts for the long-form note.
  const approveNotifBox: {
    data: { recipientUserId: string; employeeFirstName: string; amount: string } | null;
  } = { data: null };

  try {
    const result = await prisma.$transaction<ApproveAdvanceResult>(async (tx) => {
      const row = await tx.cashAdvance.findUnique({
        where: { id: input.cashAdvanceId },
        select: {
          id: true,
          status: true,
          amount: true,
          employee: { select: { firstName: true, userId: true } },
        },
      });
      if (!row) {
        return { ok: false as const, code: 'not-found' as const, message: 'ไม่พบคำขอเบิก' };
      }
      if (row.status !== 'Pending') {
        return {
          ok: false as const,
          code: 'not-pending' as const,
          message: 'คำขอนี้ถูกตัดสินใจไปแล้ว',
        };
      }

      const trimmedUrl = input.receiptUrl?.trim();

      await tx.cashAdvance.update({
        where: { id: row.id },
        data: {
          status: 'Approved',
          approvedById: user.id,
          approvedAt: new Date(),
          receiptUrl: trimmedUrl && trimmedUrl.length > 0 ? trimmedUrl : null,
          // isDeducted stays false until payroll consumes this (Phase 2)
        },
      });

      await auditLogTx(tx, {
        actorId: user.id,
        action: 'advance.approve',
        entityType: 'CashAdvance',
        entityId: row.id,
        before: { status: 'Pending' },
        after: {
          status: 'Approved',
          amount: row.amount.toString(),
          receiptUrl: trimmedUrl ?? null,
        },
        metadata: { ip, userAgent, source: 'admin-ui' },
      });

      approveNotifBox.data = {
        recipientUserId: row.employee.userId,
        employeeFirstName: row.employee.firstName,
        amount: formatAmount(row.amount),
      };

      return { ok: true as const };
    });

    if (result.ok && approveNotifBox.data) {
      await sendNotification(approveNotifBox.data.recipientUserId, {
        kind: 'advance.approved',
        cashAdvanceId: input.cashAdvanceId,
        employeeFirstName: approveNotifBox.data.employeeFirstName,
        amount: approveNotifBox.data.amount,
      });
    }

    revalidatePath('/admin/advance');
    return result;
  } catch (err) {
    console.error('[approveCashAdvance] tx failed', err);
    return { ok: false, code: 'db-error', message: 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง' };
  }
}

export async function rejectCashAdvance(input: RejectInput): Promise<RejectAdvanceResult> {
  const { user } = await requireRole(['Admin']);

  const headerList = await headers();
  const ip =
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headerList.get('x-real-ip') ??
    undefined;
  const userAgent = headerList.get('user-agent') ?? undefined;

  const rejectNotifBox: {
    data: { recipientUserId: string; employeeFirstName: string; amount: string } | null;
  } = { data: null };

  try {
    const result = await prisma.$transaction<RejectAdvanceResult>(async (tx) => {
      const row = await tx.cashAdvance.findUnique({
        where: { id: input.cashAdvanceId },
        select: {
          id: true,
          status: true,
          amount: true,
          employee: { select: { firstName: true, userId: true } },
        },
      });
      if (!row) {
        return { ok: false as const, code: 'not-found' as const, message: 'ไม่พบคำขอเบิก' };
      }
      if (row.status !== 'Pending') {
        return {
          ok: false as const,
          code: 'not-pending' as const,
          message: 'คำขอนี้ถูกตัดสินใจไปแล้ว',
        };
      }

      await tx.cashAdvance.update({
        where: { id: row.id },
        data: { status: 'Rejected' },
      });

      await auditLogTx(tx, {
        actorId: user.id,
        action: 'advance.reject',
        entityType: 'CashAdvance',
        entityId: row.id,
        before: { status: 'Pending' },
        after: { status: 'Rejected', amount: row.amount.toString() },
        metadata: { ip, userAgent, source: 'admin-ui' },
      });

      rejectNotifBox.data = {
        recipientUserId: row.employee.userId,
        employeeFirstName: row.employee.firstName,
        amount: formatAmount(row.amount),
      };

      return { ok: true as const };
    });

    if (result.ok && rejectNotifBox.data) {
      await sendNotification(rejectNotifBox.data.recipientUserId, {
        kind: 'advance.rejected',
        cashAdvanceId: input.cashAdvanceId,
        employeeFirstName: rejectNotifBox.data.employeeFirstName,
        amount: rejectNotifBox.data.amount,
      });
    }

    revalidatePath('/admin/advance');
    return result;
  } catch (err) {
    console.error('[rejectCashAdvance] tx failed', err);
    return { ok: false, code: 'db-error', message: 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง' };
  }
}
