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

import { Prisma } from '@prisma/client';
import { headers } from 'next/headers';
import { advanceBalanceFor } from '@/lib/advance/available';
import { isOverCap } from '@/lib/advance/balance';
import { auditLog, auditLogTx } from '@/lib/audit/log';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { sendNotification } from '@/lib/inngest/events';
import { notifyAdminsOnLine } from '@/lib/notifications/admin-line';
import { notifyAdminsInApp } from '@/lib/notifications/in-app-bell';

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

/** Bell display name — prefer nickname. Mirrors advance/actions.ts. */
function employeeBellName(e: {
  firstName: string;
  lastName: string;
  nickname: string | null;
}): string {
  if (e.nickname && e.nickname.trim().length > 0) return e.nickname;
  return `${e.firstName} ${e.lastName}`.trim();
}

export type ApproveAdvanceResult =
  | { ok: true }
  | {
      ok: false;
      code: 'forbidden' | 'not-found' | 'not-pending' | 'over-cap' | 'db-error';
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
  const { user, authUserId } = await requirePermission('advance.approve');

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

  // Hard cap: "การเบิก ไม่เกินเงินเดือน". Checked BEFORE the tx because
  // advanceBalanceFor uses the global prisma client (not the tx). Small
  // TOCTOU window between this read and the update below — the partial-unique
  // one-Pending-per-employee index is the structural backstop against the
  // double-spend race (see src/lib/advance/available.ts). Not-found /
  // not-pending stay the tx's responsibility; we only guard a live Pending row.
  const capRow = await prisma.cashAdvance.findUnique({
    where: { id: input.cashAdvanceId },
    select: { id: true, status: true, amount: true, employeeId: true },
  });
  if (capRow && capRow.status === 'Pending') {
    // Exclude this advance from its own reserved sum — it is the Pending
    // row being decided.
    const balance = await advanceBalanceFor(capRow.employeeId, capRow.id);
    const available = balance.available; // both variants expose it (rate-based may be null)
    if (isOverCap(Number(capRow.amount), available)) {
      return {
        ok: false,
        code: 'over-cap',
        message: `เกินวงเงินที่เบิกได้ (คงเหลือ ฿${available!.toLocaleString('th-TH', { minimumFractionDigits: 2 })})`,
      };
    }
    if (available == null) {
      // Rate-based employee with no computable earnings shouldn't happen
      // (advanceBalanceFor always computes for rate-based), but never block on
      // a missing number — log and let the admin decide.
      console.warn('[approveCashAdvance] available=null for', capRow.employeeId);
    }
  }

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

    // No revalidatePath('/admin/advance'): the page is dynamic (awaits
    // searchParams), so there is no cache to clear — revalidating would only
    // trigger an in-transition RSC refresh that drops the just-settled row and
    // unmounts the review panel's confirmation. The panel owns post-action UX.
    return result;
  } catch (err) {
    console.error('[approveCashAdvance] tx failed', err);
    return { ok: false, code: 'db-error', message: 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง' };
  }
}

export async function rejectCashAdvance(input: RejectInput): Promise<RejectAdvanceResult> {
  const { user } = await requirePermission('advance.approve');

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

    // See approveCashAdvance: no revalidatePath — page is dynamic and the
    // panel owns the post-action "settled" confirmation + manual refresh.
    return result;
  } catch (err) {
    console.error('[rejectCashAdvance] tx failed', err);
    return { ok: false, code: 'db-error', message: 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง' };
  }
}

export type MarkPaidResult =
  | { ok: true }
  | { ok: false; code: 'forbidden' | 'not-found' | 'not-approved' | 'db-error'; message: string };

/**
 * Two-step payment, step 2: admin transferred the money and attaches the
 * slip. Requires status=Approved (slip before approval makes no sense;
 * the approve flow's optional receiptUrl still exists for the legacy
 * one-shot web path). paidAt is set ONCE; re-upload replaces the image only.
 */
export async function markAdvancePaid(input: {
  cashAdvanceId: string;
  receiptKey: string;
}): Promise<MarkPaidResult> {
  const { user, authUserId } = await requirePermission('advance.approve');

  const key = input.receiptKey.trim();
  if (!/^https?:\/\//i.test(key) && !key.startsWith(`${authUserId}/advance-receipts/`)) {
    return { ok: false, code: 'forbidden', message: 'ลิงก์สลิปไม่ถูกต้อง' };
  }

  const headerList = await headers();
  const ip =
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headerList.get('x-real-ip') ??
    undefined;
  const userAgent = headerList.get('user-agent') ?? undefined;

  const notifBox: {
    data: { recipientUserId: string; employeeFirstName: string; amount: string } | null;
  } = { data: null };

  try {
    const result = await prisma.$transaction<MarkPaidResult>(async (tx) => {
      const row = await tx.cashAdvance.findUnique({
        where: { id: input.cashAdvanceId },
        select: {
          id: true,
          status: true,
          amount: true,
          paidAt: true,
          receiptUrl: true,
          employee: { select: { firstName: true, userId: true } },
        },
      });
      if (!row) {
        return { ok: false as const, code: 'not-found' as const, message: 'ไม่พบคำขอเบิก' };
      }
      if (row.status !== 'Approved') {
        return {
          ok: false as const,
          code: 'not-approved' as const,
          message: 'แนบสลิปได้เฉพาะคำขอที่อนุมัติแล้ว',
        };
      }

      const firstAttach = row.paidAt === null;
      await tx.cashAdvance.update({
        where: { id: row.id },
        data: { receiptUrl: key, ...(firstAttach ? { paidAt: new Date() } : {}) },
      });

      await auditLogTx(tx, {
        actorId: user.id,
        action: 'advance.mark-paid',
        entityType: 'CashAdvance',
        entityId: row.id,
        before: { receiptUrl: row.receiptUrl, paidAt: row.paidAt?.toISOString() ?? null },
        after: { receiptUrl: key, paidAt: firstAttach ? 'now' : row.paidAt?.toISOString() },
        metadata: { ip, userAgent, source: 'liff-admin' },
      });

      if (firstAttach) {
        notifBox.data = {
          recipientUserId: row.employee.userId,
          employeeFirstName: row.employee.firstName,
          amount: formatAmount(row.amount),
        };
      }
      return { ok: true as const };
    });

    if (result.ok && notifBox.data) {
      await sendNotification(notifBox.data.recipientUserId, {
        kind: 'advance.paid',
        cashAdvanceId: input.cashAdvanceId,
        employeeFirstName: notifBox.data.employeeFirstName,
        amount: notifBox.data.amount,
      });
    }
    return result;
  } catch (err) {
    console.error('[markAdvancePaid] tx failed', err);
    return { ok: false, code: 'db-error', message: 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง' };
  }
}

// ---------------------------------------------------------------------------
// Admin "record a cash-advance request on behalf of an employee".
//
// Mirrors adminCreateLeaveRequest: for the worker whose phone is broken and
// can't use LIFF, an admin keys in the request here. It lands as **Pending**
// and flows through the SAME approve path (receipt upload + money-confirm in
// the review modal), so the audit trail and money controls stay uniform.
// Same guards as the worker submit: positive ≤2dp amount, ฿100k cap, and only
// one Pending advance per employee at a time.
// ---------------------------------------------------------------------------

export type AdminCreateAdvanceResult =
  | { ok: true; id: string }
  | {
      ok: false;
      code:
        | 'forbidden'
        | 'employee-not-found'
        | 'employee-archived'
        | 'bad-amount'
        | 'too-large'
        | 'pending-exists'
        | 'db-error';
      message: string;
    };

type AdminCreateAdvanceInput = {
  employeeId: string;
  amount: number;
};

/** Same sanity cap as the worker LIFF submit (src/lib/advance/actions.ts). */
const ADMIN_ADVANCE_MAX_AMOUNT = 100_000;

export async function adminCreateCashAdvance(
  input: AdminCreateAdvanceInput,
): Promise<AdminCreateAdvanceResult> {
  const { user } = await requirePermission('advance.approve');

  const employee = await prisma.employee.findUnique({
    where: { id: input.employeeId },
    select: {
      id: true,
      archivedAt: true,
      status: true,
      firstName: true,
      lastName: true,
      nickname: true,
    },
  });
  if (!employee) {
    return { ok: false, code: 'employee-not-found', message: 'ไม่พบพนักงาน' };
  }
  if (employee.archivedAt || employee.status === 'Archived') {
    return { ok: false, code: 'employee-archived', message: 'พนักงานคนนี้พ้นสภาพแล้ว' };
  }

  // Amount: positive, at most 2 decimal places (mirrors the worker submit).
  if (
    !Number.isFinite(input.amount) ||
    input.amount <= 0 ||
    Math.round(input.amount * 100) !== input.amount * 100
  ) {
    return {
      ok: false,
      code: 'bad-amount',
      message: 'จำนวนเงินต้องเป็นตัวเลขบวก (สูงสุด 2 ตำแหน่งหลังจุด)',
    };
  }
  if (input.amount > ADMIN_ADVANCE_MAX_AMOUNT) {
    return {
      ok: false,
      code: 'too-large',
      message: `ขอเบิกได้สูงสุด ฿${ADMIN_ADVANCE_MAX_AMOUNT.toLocaleString('th-TH')} ต่อครั้ง`,
    };
  }

  // One ACTIVE pending advance per employee — same rule the worker submit
  // enforces. `deletedAt: null` so a voided pending doesn't falsely block.
  // The DB-level partial unique index is the real guard against races.
  const pending = await prisma.cashAdvance.findFirst({
    where: { employeeId: employee.id, status: 'Pending', deletedAt: null },
    select: { id: true },
  });
  if (pending) {
    return {
      ok: false,
      code: 'pending-exists',
      message: 'พนักงานคนนี้มีคำขอเบิกที่รออนุมัติอยู่แล้ว',
    };
  }

  const headerList = await headers();
  const ip =
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headerList.get('x-real-ip') ??
    undefined;
  const userAgent = headerList.get('user-agent') ?? undefined;

  try {
    const created = await prisma.cashAdvance.create({
      data: {
        employeeId: employee.id,
        amount: new Prisma.Decimal(input.amount),
        status: 'Pending',
      },
      select: { id: true },
    });

    auditLog({
      actorId: user.id,
      action: 'advance.admin-create',
      entityType: 'CashAdvance',
      entityId: created.id,
      after: { employeeId: employee.id, amount: input.amount.toString() },
      metadata: { ip, userAgent, source: 'admin-ui' },
    });

    // Light up the admin bell so OTHER admins see the new Pending advance
    // (the worker LIFF submit does the same). Fire-and-forget.
    void notifyAdminsInApp({
      kind: 'advance.submitted',
      cashAdvanceId: created.id,
      employeeName: employeeBellName(employee),
      amount: formatAmount(input.amount),
    });
    // LINE push to paired admins — same fire-and-forget contract.
    void notifyAdminsOnLine({
      kind: 'admin.advance-submitted',
      cashAdvanceId: created.id,
      employeeName: employeeBellName(employee),
      amount: formatAmount(input.amount),
    });

    return { ok: true, id: created.id };
  } catch (err) {
    // Lost the race for the one-pending slot (the partial unique index fired).
    // Surface the friendly message rather than a generic db-error.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return {
        ok: false,
        code: 'pending-exists',
        message: 'พนักงานคนนี้มีคำขอเบิกที่รออนุมัติอยู่แล้ว',
      };
    }
    console.error('[adminCreateCashAdvance] failed', err);
    return { ok: false, code: 'db-error', message: 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง' };
  }
}
