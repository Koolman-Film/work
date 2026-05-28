'use server';

/**
 * Leave-request Server Actions for the LIFF flow.
 *
 *   - submitLeaveRequest(input) — employee proposes a date range.
 *   - cancelLeaveRequest(id)    — employee withdraws an unapproved request.
 *
 * Admin-side actions (approve / reject + Attendance expansion) live in
 * src/lib/leave/admin.ts (W4c).
 *
 * Validation policy:
 *   - startDate ≤ endDate (else error)
 *   - startDate ≥ today (no back-dating from LIFF; admins can do it
 *     manually if needed via /admin/attendance/manual in a later W).
 *   - endDate ≤ today + 365d (sanity bound; nobody books a year-long leave)
 *   - reason: required, ≤500 chars
 *   - leaveType must exist + not archived
 *   - employee is not archived + canCheckIn (same gate as attendance)
 *
 * Idempotency / overlap policy:
 *   - We REJECT submissions where any day in the range overlaps an
 *     existing Pending or Approved LeaveRequest for the same employee.
 *     Admins can override later by approving the new one and rejecting
 *     the old one manually — but we don't allow employees to submit two
 *     competing requests for the same week.
 */

import type { Employee } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { auditLog } from '@/lib/audit/log';
import { requireRole } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';
import { notifyAdminsInApp } from '@/lib/notifications/in-app-bell';
import { parseInputDate } from './working-days';

/** Display name for bell notifications. Prefers nickname when present so
 *  admins recognize "ไก่" faster than "ปรีชา สมศักดิ์". Falls back to
 *  full name for newly-onboarded employees who haven't set a nickname. */
function employeeDisplayName(e: Pick<Employee, 'firstName' | 'lastName' | 'nickname'>): string {
  if (e.nickname && e.nickname.trim().length > 0) return e.nickname;
  return `${e.firstName} ${e.lastName}`.trim();
}

export type SubmitLeaveResult =
  | { ok: true; id: string }
  | {
      ok: false;
      code:
        | 'forbidden'
        | 'bad-dates'
        | 'past-date'
        | 'too-far-future'
        | 'bad-leave-type'
        | 'overlap'
        | 'short-reason'
        | 'bad-attachment-path'
        | 'db-error';
      message: string;
    };

export type CancelLeaveResult =
  | { ok: true }
  | { ok: false; code: 'forbidden' | 'not-found' | 'not-cancellable'; message: string };

type SubmitInput = {
  leaveTypeId: string;
  /** YYYY-MM-DD (from `<input type=date>`). */
  startDate: string;
  /** YYYY-MM-DD (inclusive). */
  endDate: string;
  reason: string;
  /** Storage key for an optional medical certificate / supporting doc.
   *  Path must match `{authUserId}/leave-medical-certs/...` — Storage
   *  RLS enforces this at upload time; we re-check server-side here. */
  attachmentKey?: string | null;
};

const MAX_FUTURE_DAYS = 365;
const MIN_REASON_LENGTH = 4;

function todayUtcMidnight(): Date {
  const ymd = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  return new Date(`${ymd}T00:00:00.000Z`);
}

export async function submitLeaveRequest(input: SubmitInput): Promise<SubmitLeaveResult> {
  const { user, employee, authUserId } = await requireRole(['Staff']);
  if (!employee) {
    return { ok: false, code: 'forbidden', message: 'ไม่พบบัญชีพนักงาน' };
  }
  if (employee.archivedAt || employee.status === 'Archived') {
    return { ok: false, code: 'forbidden', message: 'บัญชีพนักงานนี้พ้นสภาพแล้ว' };
  }

  const reason = input.reason.trim();
  if (reason.length < MIN_REASON_LENGTH) {
    return {
      ok: false,
      code: 'short-reason',
      message: 'กรุณากรอกเหตุผลอย่างน้อย 4 ตัวอักษร',
    };
  }

  const start = parseInputDate(input.startDate);
  const end = parseInputDate(input.endDate);
  if (!start || !end) {
    return { ok: false, code: 'bad-dates', message: 'รูปแบบวันที่ไม่ถูกต้อง' };
  }
  if (end.getTime() < start.getTime()) {
    return { ok: false, code: 'bad-dates', message: 'วันที่สิ้นสุดต้องไม่ก่อนวันเริ่มต้น' };
  }

  const today = todayUtcMidnight();
  if (start.getTime() < today.getTime()) {
    return {
      ok: false,
      code: 'past-date',
      message: 'ไม่สามารถส่งคำขอลาย้อนหลังได้ — ติดต่อแอดมินเพื่อบันทึกย้อนหลัง',
    };
  }
  const maxFuture = new Date(today.getTime() + MAX_FUTURE_DAYS * 86_400_000);
  if (end.getTime() > maxFuture.getTime()) {
    return {
      ok: false,
      code: 'too-far-future',
      message: 'วันที่สิ้นสุดไกลเกินไป (มากกว่า 1 ปี)',
    };
  }

  // Check leave type validity.
  const lt = await prisma.leaveType.findUnique({
    where: { id: input.leaveTypeId },
    select: { id: true, name: true, archivedAt: true },
  });
  if (!lt || lt.archivedAt) {
    return { ok: false, code: 'bad-leave-type', message: 'ประเภทการลาไม่ถูกต้อง' };
  }

  // Overlap check: any existing Pending/Approved request for this
  // employee whose range intersects ours.
  const overlap = await prisma.leaveRequest.findFirst({
    where: {
      employeeId: employee.id,
      status: { in: ['Pending', 'Approved'] },
      // Standard range-overlap formula: existing.start ≤ ours.end AND
      // existing.end ≥ ours.start.
      startDate: { lte: end },
      endDate: { gte: start },
    },
    select: { id: true },
  });
  if (overlap) {
    return {
      ok: false,
      code: 'overlap',
      message: 'มีคำขอลาในช่วงวันที่นี้อยู่แล้ว',
    };
  }

  const headerList = await headers();
  const ip =
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headerList.get('x-real-ip') ??
    undefined;
  const userAgent = headerList.get('user-agent') ?? undefined;

  try {
    // Validate the optional attachment storage key shape. The Storage
    // RLS already enforces that the employee can only upload to their
    // own folder; this server-side recheck catches a misbehaving
    // client claiming a key in someone else's folder.
    const attachmentKey = input.attachmentKey?.trim() || null;
    if (attachmentKey && !attachmentKey.startsWith(`${authUserId}/leave-medical-certs/`)) {
      return {
        ok: false,
        code: 'bad-attachment-path',
        message: 'ลิงก์ไฟล์แนบไม่ถูกต้อง',
      };
    }

    const created = await prisma.leaveRequest.create({
      data: {
        employeeId: employee.id,
        leaveTypeId: lt.id,
        startDate: start,
        endDate: end,
        reason,
        status: 'Pending',
        attachmentUrl: attachmentKey,
      },
      select: { id: true },
    });

    auditLog({
      actorId: user.id,
      action: 'leave.submit',
      entityType: 'LeaveRequest',
      entityId: created.id,
      after: {
        leaveTypeId: lt.id,
        startDate: input.startDate,
        endDate: input.endDate,
        reason,
        attachmentKey: attachmentKey ?? null,
      },
      metadata: { ip, userAgent, source: 'liff' },
    });

    // Fan-out in-app bell to all active Admin/Superadmin. Fire-and-forget; if
    // this throws inside notifyAdminsInApp it's logged but doesn't fail
    // the submission — the employee shouldn't see "ระบบขัดข้อง" because
    // a notification write hiccuped.
    void notifyAdminsInApp({
      kind: 'leave.submitted',
      leaveRequestId: created.id,
      employeeName: employeeDisplayName(employee),
      leaveTypeName: lt.name,
      startDate: input.startDate,
      endDate: input.endDate,
    });

    revalidatePath('/liff/leave');
    return { ok: true, id: created.id };
  } catch (err) {
    console.error('[submitLeaveRequest] failed', err);
    return { ok: false, code: 'db-error', message: 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง' };
  }
}

export async function cancelLeaveRequest(leaveRequestId: string): Promise<CancelLeaveResult> {
  const { user, employee } = await requireRole(['Staff']);
  if (!employee) {
    return { ok: false, code: 'forbidden', message: 'ไม่พบบัญชีพนักงาน' };
  }

  const row = await prisma.leaveRequest.findUnique({
    where: { id: leaveRequestId },
    select: { id: true, employeeId: true, status: true },
  });
  if (!row) {
    return { ok: false, code: 'not-found', message: 'ไม่พบคำขอลา' };
  }
  if (row.employeeId !== employee.id) {
    // Authorisation: only the request owner can cancel their own request.
    // Admins use a different action (reject) from /admin/leave.
    return { ok: false, code: 'forbidden', message: 'คุณไม่ใช่เจ้าของคำขอลานี้' };
  }
  if (row.status !== 'Pending') {
    return {
      ok: false,
      code: 'not-cancellable',
      message: 'ยกเลิกได้เฉพาะคำขอที่ยังไม่ได้รับการตรวจสอบ',
    };
  }

  try {
    await prisma.leaveRequest.update({
      where: { id: row.id },
      data: { status: 'Cancelled' },
    });
    auditLog({
      actorId: user.id,
      action: 'leave.cancel',
      entityType: 'LeaveRequest',
      entityId: row.id,
      before: { status: 'Pending' },
      after: { status: 'Cancelled' },
      metadata: { source: 'liff' },
    });
    revalidatePath('/liff/leave');
    return { ok: true };
  } catch (err) {
    console.error('[cancelLeaveRequest] failed', err);
    return { ok: false, code: 'forbidden', message: 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง' };
  }
}
