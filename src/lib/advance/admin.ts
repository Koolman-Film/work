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
  const { user } = await requireRole(['Admin']);

  const headerList = await headers();
  const ip =
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headerList.get('x-real-ip') ??
    undefined;
  const userAgent = headerList.get('user-agent') ?? undefined;

  try {
    const result = await prisma.$transaction<ApproveAdvanceResult>(async (tx) => {
      const row = await tx.cashAdvance.findUnique({
        where: { id: input.cashAdvanceId },
        select: { id: true, status: true, amount: true },
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

      return { ok: true as const };
    });

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

  try {
    const result = await prisma.$transaction<RejectAdvanceResult>(async (tx) => {
      const row = await tx.cashAdvance.findUnique({
        where: { id: input.cashAdvanceId },
        select: { id: true, status: true, amount: true },
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

      return { ok: true as const };
    });

    revalidatePath('/admin/advance');
    return result;
  } catch (err) {
    console.error('[rejectCashAdvance] tx failed', err);
    return { ok: false, code: 'db-error', message: 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง' };
  }
}
