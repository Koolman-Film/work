'use server';

/**
 * `createManualAttendance` — admin records an Attendance row directly,
 * bypassing the LIFF check-in flow.
 *
 * Used for the cases where an employee couldn't tap their phone:
 *   - **Absent** — didn't show up (sick, no-show)
 *   - **Late** — arrived after schedule + tolerance but didn't check in
 *   - **EarlyLeave** — left early without checking out
 *
 * Deliberately NOT supported here:
 *   - `CheckIn` / `CheckOut` — bypassing GPS verification by faking
 *     a check-in defeats the purpose of geofence enforcement
 *   - `OnLeave` — auto-created by `approveLeaveRequest` per range; manual
 *     entry would create duplicates the working-days calculator can't
 *     reconcile
 *
 * Idempotency: the schema doesn't have a UNIQUE on `(employeeId, date,
 * type)`, but we enforce it here to prevent admins double-clicking the
 * submit button into two identical rows.
 */

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { auditLog } from '@/lib/audit/log';
import { canActOnEmployeeBranches, getPermittedBranches } from '@/lib/auth/branch-scope';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';

export type ManualAttendanceType = 'Absent' | 'Late' | 'EarlyLeave';

export type CreateManualInput = {
  employeeId: string;
  /** YYYY-MM-DD from <input type=date>; treated as Bangkok-local calendar day. */
  date: string;
  type: ManualAttendanceType;
  /** Required for Late + EarlyLeave; ignored for Absent. */
  durationMinutes?: number | null;
  /** Free-form note explaining why this manual entry exists. ≤500 chars. */
  note?: string | null;
};

export type CreateManualResult =
  | { ok: true; id: string }
  | {
      ok: false;
      code:
        | 'forbidden'
        | 'employee-not-found'
        | 'employee-archived'
        | 'bad-date'
        | 'future-date'
        | 'bad-duration'
        | 'duplicate'
        | 'db-error';
      message: string;
    };

const MAX_NOTE = 500;
const MAX_DURATION_MIN = 1440; // 24 hours — sanity cap

/** Parse YYYY-MM-DD as UTC-midnight Date (matches @db.Date semantics). */
function parseInputDate(raw: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  // Round-trip check (catches Feb 30 etc.)
  if (d.toISOString().slice(0, 10) !== raw) return null;
  return d;
}

/** Today at UTC midnight, in Asia/Bangkok terms. */
function bangkokTodayUtc(): Date {
  const ymd = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  return new Date(`${ymd}T00:00:00.000Z`);
}

export async function createManualAttendance(
  input: CreateManualInput,
): Promise<CreateManualResult> {
  // Load the target employee first so we can branch-gate (mirrors void.ts).
  const emp = await prisma.employee.findUnique({
    where: { id: input.employeeId },
    select: { id: true, archivedAt: true, status: true, branchId: true, assignedBranchIds: true },
  });
  if (!emp) {
    return { ok: false, code: 'employee-not-found', message: 'ไม่พบพนักงาน' };
  }

  const { user } = await requirePermission('attendance.manual-create');
  const permitted = await getPermittedBranches(user, 'attendance.manual-create');
  if (!canActOnEmployeeBranches(permitted, [emp.branchId, ...emp.assignedBranchIds])) notFound();

  if (emp.archivedAt || emp.status === 'Archived') {
    return {
      ok: false,
      code: 'employee-archived',
      message: 'พนักงานคนนี้พ้นสภาพแล้ว',
    };
  }

  // Validate date
  const date = parseInputDate(input.date);
  if (!date) {
    return { ok: false, code: 'bad-date', message: 'รูปแบบวันที่ไม่ถูกต้อง' };
  }
  const today = bangkokTodayUtc();
  if (date.getTime() > today.getTime()) {
    return { ok: false, code: 'future-date', message: 'ไม่สามารถบันทึกย้อนล่วงหน้าได้' };
  }

  // Validate duration — required for Late/EarlyLeave, ignored for Absent
  let durationMinutes: number | null = null;
  if (input.type === 'Late' || input.type === 'EarlyLeave') {
    const d = Number(input.durationMinutes);
    if (!Number.isFinite(d) || d <= 0 || d > MAX_DURATION_MIN) {
      return {
        ok: false,
        code: 'bad-duration',
        message: `กรุณากรอกจำนวนนาที (1-${MAX_DURATION_MIN})`,
      };
    }
    durationMinutes = Math.round(d);
  }

  // Validate note length
  const note = input.note?.trim() || null;
  if (note && note.length > MAX_NOTE) {
    return {
      ok: false,
      code: 'bad-duration', // re-using closest existing code; not adding a new one for a length-only error
      message: `หมายเหตุยาวเกิน ${MAX_NOTE} ตัวอักษร`,
    };
  }

  // Idempotency — block duplicate (employee, date, type) which would
  // happen on double-click. The schema doesn't enforce this at the DB
  // level intentionally (admins may legitimately enter multiple rows
  // for different reasons), but for the same form submission it's
  // almost certainly user error.
  const existing = await prisma.attendance.findFirst({
    where: { employeeId: emp.id, date, type: input.type },
    select: { id: true },
  });
  if (existing) {
    return {
      ok: false,
      code: 'duplicate',
      message: `มีรายการ "${input.type}" ของพนักงานคนนี้ในวันนี้แล้ว`,
    };
  }

  const headerList = await headers();
  const ip =
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headerList.get('x-real-ip') ??
    undefined;
  const userAgent = headerList.get('user-agent') ?? undefined;

  try {
    const created = await prisma.attendance.create({
      data: {
        employeeId: emp.id,
        date,
        type: input.type,
        source: 'Manual',
        durationMinutes,
        createdById: user.id,
        // Note: the admin's "why I had to manually enter this" note is
        // captured in the audit log below, NOT on the Attendance row.
        // The schema's `disputeReason` is reserved for actual dispute
        // semantics; reusing it for Manual notes would mean every UI
        // showing "dispute reason" had to also handle "is this actually
        // a manual note?" — bad coupling.
        // If we later need an Attendance.note column, that's a Phase-2
        // migration with a clear name.
      },
      select: { id: true },
    });

    auditLog({
      actorId: user.id,
      action: 'attendance.manual-create',
      entityType: 'Attendance',
      entityId: created.id,
      after: {
        employeeId: emp.id,
        date: input.date,
        type: input.type,
        durationMinutes,
        note,
      },
      metadata: { ip, userAgent, source: 'admin-manual' },
    });

    revalidatePath('/admin');
    revalidatePath('/admin/attendance');
    return { ok: true, id: created.id };
  } catch (err) {
    console.error('[createManualAttendance] db error', err);
    return {
      ok: false,
      code: 'db-error',
      message: 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง',
    };
  }
}
