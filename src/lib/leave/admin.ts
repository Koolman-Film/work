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
import { workingDaysIn } from './working-days';

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

      // Pull holidays overlapping the range (read inside the same tx so
      // a concurrent holiday-create doesn't drift our computation).
      const holidays = await tx.holiday.findMany({
        where: {
          archivedAt: null,
          date: { gte: req.startDate, lte: req.endDate },
        },
        select: { date: true },
      });

      const workingDays = workingDaysIn({
        startDate: req.startDate,
        endDate: req.endDate,
        holidays: holidays.map((h) => h.date),
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

      return {
        ok: true as const,
        attendanceRowsCreated: inserted.count,
        workingDays: workingDays.length,
      };
    });

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

  try {
    const result = await prisma.$transaction<RejectResult>(async (tx) => {
      const req = await tx.leaveRequest.findUnique({
        where: { id: input.leaveRequestId },
        select: { id: true, status: true },
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

      return { ok: true as const };
    });

    revalidatePath('/admin/leave');
    return result;
  } catch (err) {
    console.error('[rejectLeaveRequest] tx failed', err);
    return { ok: false, code: 'db-error', message: 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง' };
  }
}
