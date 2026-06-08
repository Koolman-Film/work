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

import { headers } from 'next/headers';
import { auditLogTx } from '@/lib/audit/log';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { sendNotification } from '@/lib/inngest/events';
import { getLeaveConfig } from './leave-config';
import { segmentFor, segmentsOverlap } from './units';
import { expandHolidaysWithSubstitutes, workingDaysIn } from './working-days';

/** Format a Date's Bangkok wall-clock time as "HH:MM" for segment comparison.
 *  OnLeave rows store clockInAt/clockOutAt as the segment bounds on the date. */
function hhmm(d: Date): string {
  return d.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

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
  const { user } = await requirePermission('leave.approve');

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
          unit: true,
          startTime: true,
          endTime: true,
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

      const cfg = await getLeaveConfig();
      const segment = segmentFor(req.unit, cfg, req.startTime, req.endTime);
      if (!segment) {
        return { ok: false as const, code: 'db-error' as const, message: 'ช่วงเวลาการลาไม่ถูกต้อง' };
      }

      // FullDay → one row per working day, each a full standard day.
      // Partial → exactly one row on the single date (workingDays has 1 entry;
      // if 0, the date is a closed day and there is nothing to charge).
      const targetDates = workingDays;
      if (targetDates.length === 0) {
        return {
          ok: false as const,
          code: 'db-error' as const,
          message: 'ไม่มีวันทำงานในช่วงที่เลือก',
        };
      }

      // Per-date time-overlap guard against existing OnLeave rows (a date may
      // hold two disjoint partial leaves, but not overlapping ones / a full day).
      const existing = await tx.attendance.findMany({
        where: {
          employeeId: req.employeeId,
          type: 'OnLeave',
          deletedAt: null,
          date: { in: targetDates },
          leaveRequestId: { not: req.id },
        },
        select: { date: true, clockInAt: true, clockOutAt: true },
      });
      const newStart = req.unit === 'FullDay' ? null : segment.startTime;
      const newEnd = req.unit === 'FullDay' ? null : segment.endTime;
      const clash = existing.find((e) => {
        const eStart = e.clockInAt ? hhmm(e.clockInAt) : null;
        const eEnd = e.clockOutAt ? hhmm(e.clockOutAt) : null;
        return segmentsOverlap(newStart, newEnd, eStart, eEnd);
      });
      if (clash) {
        return {
          ok: false as const,
          code: 'db-error' as const,
          message: `วันที่ ${clash.date.toISOString().slice(0, 10)} มีการลาทับซ้อนอยู่แล้ว`,
        };
      }

      // Partial leaves carry the segment as clockInAt/clockOutAt so the live
      // board can show the window and OT can reconcile. Build the BANGKOK
      // instant (+07:00, no DST in Thailand) so it renders as the chosen wall-
      // clock time everywhere clockInAt is formatted in Asia/Bangkok — and so
      // the hhmm() round-trip used by the overlap guard is consistent.
      function segInstant(date: Date, time: string): Date {
        return new Date(`${date.toISOString().slice(0, 10)}T${time}:00+07:00`);
      }

      const attendanceRows = targetDates.map((d) => ({
        employeeId: req.employeeId,
        date: d,
        type: 'OnLeave' as const,
        source: 'Manual' as const,
        durationMinutes: segment.minutes,
        clockInAt: segment.startTime ? segInstant(d, segment.startTime) : null,
        clockOutAt: segment.endTime ? segInstant(d, segment.endTime) : null,
        leaveRequestId: req.id,
        createdById: user.id,
      }));

      const inserted = await tx.attendance.createMany({ data: attendanceRows });
      const chargedMinutes = segment.minutes * targetDates.length;

      // Mark the LeaveRequest itself approved.
      await tx.leaveRequest.update({
        where: { id: req.id },
        data: {
          status: 'Approved',
          reviewedById: user.id,
          reviewedAt: new Date(),
          reviewNote: note,
          chargedMinutes,
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
          unit: req.unit,
          chargedMinutes,
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

    // Intentionally NOT revalidatePath('/admin/leave') here: the page is
    // dynamic (it awaits searchParams), so there is no cache to clear — the
    // only effect would be an in-transition RSC refresh that unmounts the
    // review panel's "settled" confirmation before the admin can read it.
    // The panel owns the post-action UX and prompts a manual refresh.
    return result;
  } catch (err) {
    console.error('[approveLeaveRequest] tx failed', err);
    return { ok: false, code: 'db-error', message: 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง' };
  }
}

export async function rejectLeaveRequest(input: Input): Promise<RejectResult> {
  const { user } = await requirePermission('leave.approve');

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

    // See approveLeaveRequest: no revalidatePath — page is dynamic and the
    // panel owns the post-action "settled" confirmation + manual refresh.
    return result;
  } catch (err) {
    console.error('[rejectLeaveRequest] tx failed', err);
    return { ok: false, code: 'db-error', message: 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง' };
  }
}
