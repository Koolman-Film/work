'use server';

/**
 * Admin actions for reviewing Disputed check-ins.
 *
 * State machine on the Attendance row:
 *
 *   checkInStatus=Disputed  ──[approve]──→  checkInStatus=Confirmed,
 *                                            isOverridden=true,
 *                                            overrideNote=<admin note>
 *
 *   checkInStatus=Disputed  ──[reject]───→  checkInStatus=Rejected,
 *                                            isOverridden=true,
 *                                            overrideNote=<admin note>
 *
 * Both transitions are one-way for the row's lifecycle. Once an admin has
 * decided, the row is "settled" — `isOverridden=true` is the breadcrumb
 * that payroll/reporting checks before counting this row.
 *
 * Why "approve" and "reject" instead of "override status to X" generic
 * setter:
 *   - The two intents have different downstream consequences. An approved
 *     check-in counts as a worked day; a rejected one does not.
 *   - Each gets a distinct AuditAction so the audit log filter is honest
 *     about what happened (we have `attendance.dispute-approve` and
 *     `attendance.dispute-reject` already enumerated in audit/log.ts).
 */

import { headers } from 'next/headers';
import { auditLogTx } from '@/lib/audit/log';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { sendNotification } from '@/lib/inngest/events';

export type ReviewResult =
  | { ok: true; nextStatus: 'Confirmed' | 'Rejected' }
  | { ok: false; code: 'not-found' | 'not-disputed' | 'forbidden' | 'db-error'; message: string };

type ReviewInput = {
  attendanceId: string;
  /** Required — admin must explain their decision. Becomes overrideNote. */
  note: string;
};

async function review(input: ReviewInput, decision: 'approve' | 'reject'): Promise<ReviewResult> {
  // Load the disputed record's employee branch before gating (mirrors void.ts).
  const target = await prisma.attendance.findUnique({
    where: { id: input.attendanceId },
    select: { employee: { select: { branchId: true } } },
  });
  if (!target) {
    return { ok: false, code: 'not-found', message: 'ไม่พบรายการลงเวลา' };
  }

  const { user } = await requirePermission('attendance.dispute-resolve', {
    branchId: target.employee.branchId,
  });

  const trimmedNote = input.note.trim();
  if (trimmedNote.length === 0) {
    return {
      ok: false,
      code: 'forbidden',
      message: 'กรุณาระบุเหตุผลของการตัดสินใจ',
    };
  }

  const headerList = await headers();
  const ip =
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headerList.get('x-real-ip') ??
    undefined;
  const userAgent = headerList.get('user-agent') ?? undefined;

  const nextStatus = decision === 'approve' ? 'Confirmed' : 'Rejected';
  const action =
    decision === 'approve' ? 'attendance.dispute-approve' : 'attendance.dispute-reject';

  // Holder object — see src/lib/leave/admin.ts for the closure-narrowing
  // workaround note.
  const notifBox: {
    data: { recipientUserId: string; employeeFirstName: string; date: string } | null;
  } = { data: null };

  try {
    const result = await prisma.$transaction<ReviewResult>(async (tx) => {
      const row = await tx.attendance.findUnique({
        where: { id: input.attendanceId },
        select: {
          id: true,
          checkInStatus: true,
          isOverridden: true,
          employeeId: true,
          date: true,
          employee: { select: { firstName: true, userId: true } },
        },
      });

      if (!row) {
        return {
          ok: false,
          code: 'not-found' as const,
          message: 'ไม่พบรายการนี้',
        };
      }

      // Guard: an already-reviewed row is settled. Reopening requires a
      // separate "edit attendance" flow (not in W3c scope). This prevents
      // accidental double-clicks from racing.
      if (row.checkInStatus !== 'Disputed') {
        return {
          ok: false,
          code: 'not-disputed' as const,
          message: 'รายการนี้ถูกตัดสินใจไปแล้ว',
        };
      }

      const updated = await tx.attendance.update({
        where: { id: row.id },
        data: {
          checkInStatus: nextStatus,
          isOverridden: true,
          overrideNote: trimmedNote,
        },
      });

      await auditLogTx(tx, {
        actorId: user.id,
        action,
        entityType: 'Attendance',
        entityId: row.id,
        before: { checkInStatus: 'Disputed', isOverridden: row.isOverridden },
        after: {
          checkInStatus: updated.checkInStatus,
          isOverridden: updated.isOverridden,
          overrideNote: updated.overrideNote,
        },
        metadata: { ip, userAgent, source: 'admin-ui' },
      });

      notifBox.data = {
        recipientUserId: row.employee.userId,
        employeeFirstName: row.employee.firstName,
        date: row.date.toISOString().slice(0, 10),
      };

      return { ok: true as const, nextStatus };
    });

    if (result.ok && notifBox.data) {
      await sendNotification(notifBox.data.recipientUserId, {
        kind:
          decision === 'approve' ? 'attendance.dispute-approved' : 'attendance.dispute-rejected',
        attendanceId: input.attendanceId,
        employeeFirstName: notifBox.data.employeeFirstName,
        date: notifBox.data.date,
        reviewNote: trimmedNote,
      });
    }

    return result;
  } catch (err) {
    console.error('[admin-review] tx failed', err);
    return {
      ok: false,
      code: 'db-error',
      message: 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง',
    };
  }
}

export async function approveDisputed(input: ReviewInput): Promise<ReviewResult> {
  return review(input, 'approve');
}

export async function rejectDisputed(input: ReviewInput): Promise<ReviewResult> {
  return review(input, 'reject');
}
