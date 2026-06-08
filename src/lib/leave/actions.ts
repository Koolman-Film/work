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
import { getLeaveConfig } from './leave-config';
import { type LeaveUnit, segmentFor, segmentsOverlap } from './units';
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
        | 'bad-unit'
        | 'bad-segment'
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
  /** Granularity. Defaults to FullDay when omitted (back-compat). The
   *  `LeaveUnit` string union from ./units shares the Prisma enum's literal
   *  values, so it's assignable to prisma.leaveRequest.create({ data: { unit } }). */
  unit?: LeaveUnit;
  /** "HH:MM" — required for Hourly; ignored for halves (derived). */
  startTime?: string | null;
  endTime?: string | null;
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
    select: {
      id: true,
      name: true,
      archivedAt: true,
      allowFullDay: true,
      allowHalfDay: true,
      allowHourly: true,
    },
  });
  if (!lt || lt.archivedAt) {
    return { ok: false, code: 'bad-leave-type', message: 'ประเภทการลาไม่ถูกต้อง' };
  }

  const unit: LeaveUnit = input.unit ?? 'FullDay';
  const allowed =
    (unit === 'FullDay' && lt.allowFullDay) ||
    ((unit === 'HalfMorning' || unit === 'HalfAfternoon') && lt.allowHalfDay) ||
    (unit === 'Hourly' && lt.allowHourly);
  if (!allowed) {
    return { ok: false, code: 'bad-unit', message: 'ประเภทการลานี้ไม่รองรับหน่วยที่เลือก' };
  }

  // Partial units are single-date and must fall on an open weekday. (Sunday is
  // the hardcoded closed day; holidays are caught authoritatively at approval,
  // where the Holiday table is consulted — see admin.ts targetDates guard.)
  const isPartial = unit !== 'FullDay';
  if (isPartial) {
    if (start.getTime() !== end.getTime()) {
      return { ok: false, code: 'bad-segment', message: 'การลาบางส่วนต้องเป็นวันเดียว' };
    }
    if (start.getUTCDay() === 0) {
      return { ok: false, code: 'bad-segment', message: 'ไม่สามารถลาบางส่วนในวันหยุดได้' };
    }
  }

  const cfg = await getLeaveConfig();
  const segment = segmentFor(unit, cfg, input.startTime, input.endTime);
  if (!segment) {
    return { ok: false, code: 'bad-segment', message: 'ช่วงเวลาที่เลือกไม่ถูกต้อง' };
  }

  // Overlap: pull every Pending/Approved request that intersects our date
  // range, then reject only when the day actually conflicts. Two PARTIAL
  // leaves on a shared date are allowed if their time segments are disjoint.
  const overlaps = await prisma.leaveRequest.findMany({
    where: {
      employeeId: employee.id,
      status: { in: ['Pending', 'Approved'] },
      deletedAt: null,
      startDate: { lte: end },
      endDate: { gte: start },
    },
    select: { unit: true, startTime: true, endTime: true },
  });
  const conflict = overlaps.some((o) => {
    // Either side full-day (or multi-day) → whole-day occupancy → conflict.
    if (unit === 'FullDay' || o.unit === 'FullDay') return true;
    // Both partial + single-date: conflict only if the time segments overlap.
    return segmentsOverlap(segment.startTime, segment.endTime, o.startTime, o.endTime);
  });
  if (conflict) {
    return { ok: false, code: 'overlap', message: 'มีคำขอลาที่ทับซ้อนช่วงวัน/เวลานี้อยู่แล้ว' };
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
        unit,
        startTime: segment.startTime,
        endTime: segment.endTime,
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
