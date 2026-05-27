'use server';

/**
 * Admin-side leave actions: approve + reject.
 *
 * The interesting one is `approveLeaveRequest`. It's the state-transition
 * from "intent" (LeaveRequest row) to "fact" (Attendance(OnLeave) rows
 * for every working day in the range). Both must commit together or
 * neither commits — wrapped in a single Prisma transaction.
 *
 * Working-day expansion:
 *   - Skip Sundays (Koolman's closed day per v1)
 *   - Skip non-archived Holiday rows whose date falls in the range
 *
 * Duplicate handling:
 *   - The Attendance @@unique([employeeId, date, type]) constraint catches
 *     the case where an OnLeave row already exists (re-approval, or
 *     overlap with a previously-approved leave). We use createMany with
 *     skipDuplicates so the transaction doesn't abort; the audit log
 *     captures the actual count inserted.
 *
 * Audit:
 *   - `leave.approve` / `leave.reject` actions, with before/after status
 *     + reviewNote + the list of dates that became Attendance rows on
 *     approve (for the inevitable "why was I marked OnLeave on X" support
 *     thread).
 */

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { auditLogTx } from '@/lib/audit/log';
import { requireRole } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';
import { sendNotification } from '@/lib/inngest/events';
import { expandHolidaysWithSubstitutes, workingDaysIn } from './working-days';

export type ApproveResult =
  | { ok: true; attendanceRowsCreated: number; workingDays: number }
  | {
      ok: false;
      code: 'forbidden' | 'not-found' | 'not-pending' | 'short-note' | 'db-error';
      message: string;
    };

export type RejectResult =
  | { ok: true }
  | {
      ok: false;
      code: 'forbidden' | 'not-found' | 'not-pending' | 'short-note' | 'db-error';
      message: string;
    };

const MIN_NOTE_LENGTH = 1; // approval note can be a single "ok"; rejection note we don't enforce more strictly here either

type Input = {
  leaveRequestId: string;
  note: string;
};

export async function approveLeaveRequest(input: Input): Promise<ApproveResult> {
  const { user } = await requireRole(['Admin']);

  const note = input.note.trim();
  if (note.length < MIN_NOTE_LENGTH) {
    return { ok: false, code: 'short-note', message: 'กรุณาระบุหมายเหตุ' };
  }

  const headerList = await headers();
  const ip =
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headerList.get('x-real-ip') ??
    undefined;
  const userAgent = headerList.get('user-agent') ?? undefined;

  // The notification payload captured INSIDE the tx (so it includes the
  // employee + leave-type data we already have to fetch anyway), then
  // FIRED AFTER the tx commits. Firing inside the tx would leak an event
  // for a tx that later rolls back.
  //
  // We hold the captured data on an object property rather than via
  // `let foo = null`. Reason: TypeScript's flow-analysis loses track of
  // assignments to a let-variable from inside an async closure and
  // narrows the post-tx type to `never`. Object mutation isn't subject
  // to the same narrowing — the property type stays as declared.
  const notifBox: {
    data: {
      recipientUserId: string;
      employeeFirstName: string;
      leaveTypeName: string;
      startDate: string;
      endDate: string;
      workingDayCount: number;
    } | null;
  } = { data: null };

  try {
    const result = await prisma.$transaction<ApproveResult>(async (tx) => {
      const req = await tx.leaveRequest.findUnique({
        where: { id: input.leaveRequestId },
        select: {
          id: true,
          status: true,
          employeeId: true,
          leaveTypeId: true,
          startDate: true,
          endDate: true,
          employee: { select: { firstName: true, userId: true } },
          leaveType: { select: { name: true } },
        },
      });

      if (!req) {
        return { ok: false as const, code: 'not-found' as const, message: 'ไม่พบคำขอลา' };
      }
      if (req.status !== 'Pending') {
        return {
          ok: false as const,
          code: 'not-pending' as const,
          message: 'คำขอนี้ถูกตัดสินใจไปแล้ว',
        };
      }

      // Pull holidays. We extend the lower bound by 1 day so a Sunday
      // holiday immediately before `startDate` correctly contributes a
      // Monday substitute that falls inside the leave range.
      const dayBeforeStart = new Date(req.startDate.getTime() - 86_400_000);
      const holidays = await tx.holiday.findMany({
        where: {
          archivedAt: null,
          date: { gte: dayBeforeStart, lte: req.endDate },
        },
        select: { date: true },
      });

      // Auto-add Monday-after-Sunday substitutes per Thai labor law
      // ("วันหยุดชดเชย"). Dedups against admin-entered substitute rows.
      const expandedHolidays = expandHolidaysWithSubstitutes(holidays.map((h) => h.date));

      const workingDays = workingDaysIn({
        startDate: req.startDate,
        endDate: req.endDate,
        holidays: expandedHolidays,
      });

      // Build the Attendance rows. `date` is the calendar day (UTC midnight,
      // matching @db.Date). `clockInAt/clockOutAt` stay null — the row's
      // existence + type=OnLeave is the signal. `createdById` = admin doing
      // the approval (audit trail).
      const attendanceRows = workingDays.map((d) => ({
        employeeId: req.employeeId,
        date: d,
        type: 'OnLeave' as const,
        source: 'Manual' as const,
        leaveRequestId: req.id,
        createdById: user.id,
      }));

      const inserted =
        attendanceRows.length > 0
          ? await tx.attendance.createMany({
              data: attendanceRows,
              // If a previous approval already created some of these rows
              // (admin re-approves after a bug), don't blow up the tx.
              skipDuplicates: true,
            })
          : { count: 0 };

      // Mark the LeaveRequest itself approved.
      await tx.leaveRequest.update({
        where: { id: req.id },
        data: {
          status: 'Approved',
          reviewedById: user.id,
          reviewedAt: new Date(),
          reviewNote: note,
        },
      });

      await auditLogTx(tx, {
        actorId: user.id,
        action: 'leave.approve',
        entityType: 'LeaveRequest',
        entityId: req.id,
        before: { status: 'Pending' },
        after: {
          status: 'Approved',
          reviewNote: note,
          attendanceRowsCreated: inserted.count,
          workingDays: workingDays.length,
          dates: workingDays.map((d) => d.toISOString().slice(0, 10)),
        },
        metadata: { ip, userAgent, source: 'admin-ui' },
      });

      // Stash for after-tx notification (see comment above the try block).
      notifBox.data = {
        recipientUserId: req.employee.userId,
        employeeFirstName: req.employee.firstName,
        leaveTypeName: req.leaveType.name,
        startDate: req.startDate.toISOString().slice(0, 10),
        endDate: req.endDate.toISOString().slice(0, 10),
        workingDayCount: workingDays.length,
      };

      return {
        ok: true as const,
        attendanceRowsCreated: inserted.count,
        workingDays: workingDays.length,
      };
    });

    // Fire-and-await notification AFTER the tx commits. Inngest's send is
    // typically <100ms; we don't want the action to block the response on
    // network, but losing the event would be worse than waiting briefly.
    if (result.ok && notifBox.data) {
      await sendNotification(notifBox.data.recipientUserId, {
        kind: 'leave.approved',
        leaveRequestId: input.leaveRequestId,
        employeeFirstName: notifBox.data.employeeFirstName,
        leaveTypeName: notifBox.data.leaveTypeName,
        startDate: notifBox.data.startDate,
        endDate: notifBox.data.endDate,
        workingDays: notifBox.data.workingDayCount,
        reviewNote: note,
      });
    }

    revalidatePath('/admin/leave');
    return result;
  } catch (err) {
    console.error('[approveLeaveRequest] tx failed', err);
    return { ok: false, code: 'db-error', message: 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง' };
  }
}

export async function rejectLeaveRequest(input: Input): Promise<RejectResult> {
  const { user } = await requireRole(['Admin']);

  const note = input.note.trim();
  if (note.length < MIN_NOTE_LENGTH) {
    return { ok: false, code: 'short-note', message: 'กรุณาระบุเหตุผลของการปฏิเสธ' };
  }

  const headerList = await headers();
  const ip =
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headerList.get('x-real-ip') ??
    undefined;
  const userAgent = headerList.get('user-agent') ?? undefined;

  // Object holder to dodge TS's let-in-async-closure → never narrowing.
  // See approveLeaveRequest above for the long-form explanation.
  const rejectNotifBox: {
    data: {
      recipientUserId: string;
      employeeFirstName: string;
      leaveTypeName: string;
      startDate: string;
      endDate: string;
    } | null;
  } = { data: null };

  try {
    const result = await prisma.$transaction<RejectResult>(async (tx) => {
      const req = await tx.leaveRequest.findUnique({
        where: { id: input.leaveRequestId },
        select: {
          id: true,
          status: true,
          startDate: true,
          endDate: true,
          employee: { select: { firstName: true, userId: true } },
          leaveType: { select: { name: true } },
        },
      });
      if (!req) return { ok: false as const, code: 'not-found' as const, message: 'ไม่พบคำขอลา' };
      if (req.status !== 'Pending') {
        return {
          ok: false as const,
          code: 'not-pending' as const,
          message: 'คำขอนี้ถูกตัดสินใจไปแล้ว',
        };
      }

      await tx.leaveRequest.update({
        where: { id: req.id },
        data: {
          status: 'Rejected',
          reviewedById: user.id,
          reviewedAt: new Date(),
          reviewNote: note,
        },
      });

      await auditLogTx(tx, {
        actorId: user.id,
        action: 'leave.reject',
        entityType: 'LeaveRequest',
        entityId: req.id,
        before: { status: 'Pending' },
        after: { status: 'Rejected', reviewNote: note },
        metadata: { ip, userAgent, source: 'admin-ui' },
      });

      rejectNotifBox.data = {
        recipientUserId: req.employee.userId,
        employeeFirstName: req.employee.firstName,
        leaveTypeName: req.leaveType.name,
        startDate: req.startDate.toISOString().slice(0, 10),
        endDate: req.endDate.toISOString().slice(0, 10),
      };

      return { ok: true as const };
    });

    if (result.ok && rejectNotifBox.data) {
      await sendNotification(rejectNotifBox.data.recipientUserId, {
        kind: 'leave.rejected',
        leaveRequestId: input.leaveRequestId,
        employeeFirstName: rejectNotifBox.data.employeeFirstName,
        leaveTypeName: rejectNotifBox.data.leaveTypeName,
        startDate: rejectNotifBox.data.startDate,
        endDate: rejectNotifBox.data.endDate,
        workingDays: null,
        reviewNote: note,
      });
    }

    revalidatePath('/admin/leave');
    return result;
  } catch (err) {
    console.error('[rejectLeaveRequest] tx failed', err);
    return { ok: false, code: 'db-error', message: 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง' };
  }
}
