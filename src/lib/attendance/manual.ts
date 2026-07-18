'use server';

/**
 * `createManualAttendance` — admin records attendance directly for the
 * cases where the LIFF check-in couldn't happen (broken phone, dead
 * battery, no signal) or the employee didn't show up at all.
 *
 * Two shapes:
 *   - `kind: 'worked'` — employee DID work. Records a `CheckIn` row with
 *     the admin-supplied times, plus a derived `Late` row using the same
 *     policy as the LIFF path, so the outcome matches "what would have
 *     happened if the phone worked".
 *   - `kind: 'absent'` — didn't show up. Records a single `Absent` row.
 *
 * `EarlyLeave` is opt-in only — nothing else in the system derives those
 * rows, so deriving them here would make manual entry stricter than LIFF.
 *
 * `OnLeave` is still not accepted: leave approval creates those rows per
 * range, and hand-entry would duplicate what the working-days calculator
 * reads.
 *
 * Geofence integrity: manual rows carry `source='Manual'`, the admin's
 * `createdById`, and null GPS columns — structurally distinguishable from
 * a GPS-verified LIFF row. The LIFF path's geofence is untouched.
 */

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { auditLog } from '@/lib/audit/log';
import { canActOnEmployeeBranches, getPermittedBranches } from '@/lib/auth/branch-scope';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { isClosedDay } from './date';
import { latePolicyFrom, resolveLatePolicy } from './late-policy';
import { bangkokDateTime, computeManualPreview } from './manual-preview';

export type CreateManualInput = {
  employeeId: string;
  /** YYYY-MM-DD — treated as a Bangkok-local calendar day. */
  date: string;
  kind: 'worked' | 'absent';
  /** HH:MM — required when kind==='worked'. */
  clockIn?: string | null;
  /** HH:MM — optional. */
  clockOut?: string | null;
  exemptLate?: boolean;
  /** Why the late deduction was waived — required when exemptLate. */
  exemptReason?: string | null;
  recordEarlyLeave?: boolean;
  /** Free-form note explaining why this manual entry exists. ≤500 chars. */
  note?: string | null;
};

export type CreateManualResult =
  | { ok: true; ids: string[] }
  | {
      ok: false;
      code:
        | 'forbidden'
        | 'employee-not-found'
        | 'employee-archived'
        | 'bad-date'
        | 'future-date'
        | 'bad-time'
        | 'bad-note'
        | 'missing-exempt-reason'
        | 'already-checked-in'
        | 'duplicate'
        | 'db-error';
      message: string;
    };

const MAX_NOTE = 500;

/** Parse YYYY-MM-DD as UTC-midnight Date (matches @db.Date semantics). */
function parseInputDate(raw: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
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
  const emp = await prisma.employee.findUnique({
    where: { id: input.employeeId },
    select: {
      id: true,
      archivedAt: true,
      status: true,
      branchId: true,
      assignedBranchIds: true,
      workSchedule: {
        select: {
          lateToleranceMin: true,
          days: { select: { dayOfWeek: true, startTime: true, endTime: true } },
        },
      },
    },
  });
  if (!emp) {
    return { ok: false, code: 'employee-not-found', message: 'ไม่พบพนักงาน' };
  }

  const { user } = await requirePermission('attendance.manual-create');
  const permitted = await getPermittedBranches(user, 'attendance.manual-create');
  if (!canActOnEmployeeBranches(permitted, [emp.branchId, ...emp.assignedBranchIds])) notFound();

  if (emp.archivedAt || emp.status === 'Archived') {
    return { ok: false, code: 'employee-archived', message: 'พนักงานคนนี้พ้นสภาพแล้ว' };
  }

  const date = parseInputDate(input.date);
  if (!date) {
    return { ok: false, code: 'bad-date', message: 'รูปแบบวันที่ไม่ถูกต้อง' };
  }
  if (date.getTime() > bangkokTodayUtc().getTime()) {
    return { ok: false, code: 'future-date', message: 'ไม่สามารถบันทึกล่วงหน้าได้' };
  }

  // ── Time validation (worked only) ──────────────────────────────────
  if (input.kind === 'worked') {
    if (!input.clockIn || !bangkokDateTime(input.date, input.clockIn)) {
      return { ok: false, code: 'bad-time', message: 'กรุณากรอกเวลาเข้างานให้ถูกต้อง (HH:MM)' };
    }
    if (input.clockOut) {
      if (!bangkokDateTime(input.date, input.clockOut)) {
        return { ok: false, code: 'bad-time', message: 'รูปแบบเวลาออกงานไม่ถูกต้อง (HH:MM)' };
      }
      if (input.clockOut <= input.clockIn) {
        return {
          ok: false,
          code: 'bad-time',
          message: 'เวลาออกงานต้องหลังเวลาเข้างาน',
        };
      }
    }
  }

  if (input.exemptLate && !input.exemptReason?.trim()) {
    return {
      ok: false,
      code: 'missing-exempt-reason',
      message: 'กรุณาระบุเหตุผลที่ยกเว้นการหักมาสาย',
    };
  }

  const note = input.note?.trim() || null;
  if (note && note.length > MAX_NOTE) {
    return { ok: false, code: 'bad-note', message: `หมายเหตุยาวเกิน ${MAX_NOTE} ตัวอักษร` };
  }

  // ── Resolve the late policy exactly as check-in.ts does ────────────
  const dow = date.getUTCDay();
  const scheduleDays = emp.workSchedule?.days ?? null;
  const hasSchedule = !!scheduleDays && scheduleDays.length > 0;

  const [payrollCfg, holiday] = await Promise.all([
    prisma.payrollConfig.findFirst({ select: { workStartTime: true, lateGraceMinutes: true } }),
    prisma.holiday.findFirst({ where: { date, archivedAt: null }, select: { id: true } }),
  ]);
  const hasHoliday = holiday != null;

  const latePolicy = resolveLatePolicy(
    scheduleDays,
    emp.workSchedule?.lateToleranceMin ?? null,
    dow,
    latePolicyFrom(payrollCfg),
  );
  const isOffDay = hasSchedule ? hasHoliday : isClosedDay(date, hasHoliday);
  const scheduledEndTime = scheduleDays?.find((d) => d.dayOfWeek === dow)?.endTime ?? null;

  const preview = computeManualPreview({
    kind: input.kind,
    date: input.date,
    clockIn: input.clockIn,
    clockOut: input.clockOut,
    latePolicy,
    scheduledEndTime,
    isOffDay,
    exemptLate: input.exemptLate,
    recordEarlyLeave: input.recordEarlyLeave,
  });

  // ── Duplicate guards ───────────────────────────────────────────────
  // A pre-existing CheckIn means the employee already checked in (LIFF or
  // an earlier manual entry). We look this up unconditionally — not only
  // when this write would itself insert a CheckIn — because recording
  // `kind: 'absent'` on a day that already has a CheckIn is just as
  // contradictory (worked AND didn't show up) and must be rejected too.
  const existingCheckIn = await prisma.attendance.findFirst({
    where: { employeeId: emp.id, date, type: 'CheckIn', deletedAt: null },
    select: { id: true },
  });
  if (existingCheckIn) {
    if (preview.rows.some((r) => r.type === 'CheckIn')) {
      return {
        ok: false,
        code: 'already-checked-in',
        message: 'พนักงานคนนี้มีการเช็คอินของวันนี้อยู่แล้ว',
      };
    }
    if (input.kind === 'absent') {
      return {
        ok: false,
        code: 'already-checked-in',
        message: 'พนักงานคนนี้มีการเช็คอินของวันนี้อยู่แล้ว จึงบันทึกเป็นขาดงานไม่ได้',
      };
    }
  }

  const existingSame = await prisma.attendance.findFirst({
    where: {
      employeeId: emp.id,
      date,
      type: { in: preview.rows.map((r) => r.type) },
      deletedAt: null,
    },
    select: { type: true },
  });
  if (existingSame) {
    return {
      ok: false,
      code: 'duplicate',
      message: `มีรายการ "${existingSame.type}" ของพนักงานคนนี้ในวันนี้แล้ว`,
    };
  }

  const clockInAt = input.clockIn ? bangkokDateTime(input.date, input.clockIn) : null;
  const clockOutAt = input.clockOut ? bangkokDateTime(input.date, input.clockOut) : null;

  const headerList = await headers();
  const ip =
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headerList.get('x-real-ip') ??
    undefined;
  const userAgent = headerList.get('user-agent') ?? undefined;

  try {
    // Sequential, not Promise.all: an interactive transaction holds a single
    // logical connection, so concurrent writes against one `tx` are a Prisma
    // anti-pattern (non-deterministic ordering, spurious errors behind
    // poolers). Every other transactional write in this codebase — see
    // check-in.ts and void.ts — awaits sequentially inside the transaction.
    const created: { id: string; type: string }[] = [];
    await prisma.$transaction(async (tx) => {
      for (const row of preview.rows) {
        const createdRow = await tx.attendance.create({
          data: {
            employeeId: emp.id,
            date,
            type: row.type,
            source: 'Manual',
            durationMinutes: row.durationMinutes,
            // Times live on the CheckIn row only; derived Late/EarlyLeave
            // rows are the deduction unit and carry no clock evidence,
            // matching how check-in.ts writes its derived Late row.
            clockInAt: row.type === 'CheckIn' ? clockInAt : null,
            clockOutAt: row.type === 'CheckIn' ? clockOutAt : null,
            createdById: user.id,
          },
          select: { id: true, type: true },
        });
        created.push(createdRow);
      }
    });

    // The CheckIn row (when present) is always the first row written — see
    // computeManualPreview — so derived Late/EarlyLeave rows can reference it
    // in their own audit entry, mirroring how check-in.ts's derived Late row
    // carries `derivedFromCheckInId`.
    const checkInId = created.find((r) => r.type === 'CheckIn')?.id ?? null;

    for (const row of created) {
      const isDerived = row.type === 'Late' || row.type === 'EarlyLeave';
      auditLog({
        actorId: user.id,
        action: 'attendance.manual-create',
        entityType: 'Attendance',
        entityId: row.id,
        after: {
          employeeId: emp.id,
          date: input.date,
          kind: input.kind,
          type: row.type,
          clockIn: input.clockIn ?? null,
          clockOut: input.clockOut ?? null,
          lateMinutes: preview.lateMinutes,
          exemptLate: !!input.exemptLate,
          exemptReason: input.exemptReason?.trim() || null,
          note,
          ...(isDerived ? { derivedFromCheckInId: checkInId } : {}),
        },
        metadata: { ip, userAgent, source: 'admin-manual' },
      });
    }

    revalidatePath('/admin');
    revalidatePath('/admin/attendance');
    return { ok: true, ids: created.map((c) => c.id) };
  } catch (err) {
    console.error('[createManualAttendance] db error', err);
    return { ok: false, code: 'db-error', message: 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง' };
  }
}
