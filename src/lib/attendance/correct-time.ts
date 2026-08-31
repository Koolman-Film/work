'use server';

import { headers } from 'next/headers';
import { payrollPeriodFor } from '@/lib/advance/period-earnings';
import { auditLogTx } from '@/lib/audit/log';
import { canActOnEmployeeBranches, getPermittedBranches } from '@/lib/auth/branch-scope';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma, prismaRaw } from '@/lib/db/prisma';
import { getLeaveConfig } from '@/lib/leave/leave-config';
import { lateMinutesForCheckIn, latePolicyFrom, resolveLatePolicy } from './late-policy';
import { buildLateContext } from './leave-late-context';
import { bangkokDateTime } from './manual-preview';

export type CorrectTimeResult = { ok: true } | { ok: false; message: string };

const DEFAULT_CUTOFF_DAY = 25;

async function reqMeta() {
  const h = await headers();
  return {
    ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? undefined,
    userAgent: h.get('user-agent') ?? undefined,
  };
}

/**
 * Correct the clock-in / clock-out time on ONE check-in row.
 *
 * This MOVES MONEY. Changing `clockInAt` changes how late the employee was,
 * which changes `deductAttendance` on the next payroll draft — so it is built
 * to the shape of `leave/waive-deduction.ts` rather than as an ordinary edit:
 *
 *   1. branch scope BEFORE any state-specific error, so an out-of-branch admin
 *      cannot learn a row's existence or its paid state from which message
 *      comes back;
 *   2. refused once the covering payroll month is closed. Frozen money is
 *      reversed by the runbook procedure, never by an edit;
 *   3. a reason is required — an unexplained change to a time that moves money
 *      is exactly what an audit trail exists to prevent;
 *   4. mutation, lateness recompute and audit in ONE transaction.
 *
 * (4) is the important one. This is an IN-PLACE overwrite with no on-row record
 * of the previous value, so the audit entry is the ONLY evidence the time was
 * ever different. A fire-and-forget audit that fails leaves a silently altered
 * time — the exact defect fixed in backfill-leave-late.ts.
 */
export async function correctAttendanceTime(input: {
  attendanceId: string;
  /** "HH:MM" in Asia/Bangkok, combined with the row's own date. */
  clockIn: string;
  /** "HH:MM", or null to clear an open check-out. */
  clockOut: string | null;
  reason: string;
}): Promise<CorrectTimeResult> {
  const reason = input.reason?.trim() ?? '';
  if (!reason) return { ok: false, message: 'กรุณาระบุเหตุผล' };

  const { user } = await requirePermission('attendance.correct-time');
  const permitted = await getPermittedBranches(user, 'attendance.correct-time');

  const row = await prismaRaw.attendance.findUnique({
    where: { id: input.attendanceId },
    select: {
      id: true,
      employeeId: true,
      date: true,
      type: true,
      clockInAt: true,
      clockOutAt: true,
      deletedAt: true,
      employee: { select: { branchId: true, assignedBranchIds: true, workScheduleId: true } },
    },
  });
  if (!row || row.deletedAt) return { ok: false, message: 'ไม่พบรายการลงเวลา' };

  const employeeBranchIds = [row.employee.branchId, ...row.employee.assignedBranchIds];
  if (!canActOnEmployeeBranches(permitted, employeeBranchIds)) {
    return { ok: false, message: 'ไม่พบรายการลงเวลา' };
  }

  if (row.type !== 'CheckIn') {
    return { ok: false, message: 'แก้ไขเวลาได้เฉพาะรายการเข้างาน' };
  }

  const ymd = row.date.toISOString().slice(0, 10);
  const nextIn = bangkokDateTime(ymd, input.clockIn);
  if (!nextIn) return { ok: false, message: 'เวลาเข้างานไม่ถูกต้อง' };
  const nextOut = input.clockOut ? bangkokDateTime(ymd, input.clockOut) : null;
  if (input.clockOut && !nextOut) return { ok: false, message: 'เวลาออกงานไม่ถูกต้อง' };
  if (nextOut && nextOut.getTime() <= nextIn.getTime()) {
    return { ok: false, message: 'เวลาออกงานต้องหลังเวลาเข้างาน' };
  }

  const payrollCfg = await prisma.payrollConfig.findFirst();
  const cutoffDay = payrollCfg?.cutoffDay ?? DEFAULT_CUTOFF_DAY;
  const month = payrollPeriodFor(ymd, cutoffDay).end.slice(0, 7);
  const closed = await prisma.payroll.findFirst({
    where: { employeeId: row.employeeId, month, status: { not: 'Draft' } },
    select: { id: true },
  });
  if (closed) {
    return {
      ok: false,
      message: 'รอบเงินเดือนของวันนี้ปิดไปแล้ว — แก้ไขเวลาไม่ได้ (ดูขั้นตอนแก้ไขย้อนหลังในคู่มือ)',
    };
  }

  // Everything needed to re-derive lateness, read BEFORE the transaction so the
  // transaction stays short.
  const dow = row.date.getUTCDay();
  const [scheduleDays, onLeaveRows, leaveCfg] = await Promise.all([
    row.employee.workScheduleId
      ? prisma.workScheduleDay.findMany({
          where: { workScheduleId: row.employee.workScheduleId },
          select: { dayOfWeek: true, startTime: true, endTime: true },
        })
      : Promise.resolve(null),
    prisma.attendance.findMany({
      where: { employeeId: row.employeeId, date: row.date, type: 'OnLeave', deletedAt: null },
      select: { clockInAt: true, clockOutAt: true },
    }),
    getLeaveConfig(),
  ]);
  const latePolicy = resolveLatePolicy(scheduleDays, null, dow, latePolicyFrom(payrollCfg));
  const lateContext = onLeaveRows.length > 0 ? buildLateContext(onLeaveRows, leaveCfg) : undefined;
  const lateMinutes = lateMinutesForCheckIn(nextIn, latePolicy ?? undefined, lateContext);

  try {
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.attendance.updateMany({
        where: { id: input.attendanceId, deletedAt: null, type: 'CheckIn' },
        data: {
          clockInAt: nextIn,
          clockOutAt: nextOut,
          isOverridden: true,
          overrideNote: reason,
        },
      });
      if (count === 0) throw new Error('STALE');

      // Keep the Late row in step IN THE SAME TRANSACTION. A corrected time
      // that leaves a stale Late row means the row and its penalty disagree
      // until someone re-runs the draft — and if nobody does, the employee is
      // charged for lateness that no longer exists.
      //
      // Update-or-soft-delete rather than blind create: the partial unique
      // index on (employeeId, date, type) rejects a second Late row for the day.
      const existingLate = await tx.attendance.findFirst({
        where: { employeeId: row.employeeId, date: row.date, type: 'Late', deletedAt: null },
        select: { id: true, durationMinutes: true },
      });
      if (lateMinutes > 0) {
        if (existingLate) {
          await tx.attendance.update({
            where: { id: existingLate.id },
            data: { durationMinutes: lateMinutes },
          });
        } else {
          await tx.attendance.create({
            data: {
              employeeId: row.employeeId,
              date: row.date,
              type: 'Late',
              source: 'Manual',
              durationMinutes: lateMinutes,
              createdById: user.id,
            },
          });
        }
      } else if (existingLate) {
        await tx.attendance.update({
          where: { id: existingLate.id },
          data: {
            deletedAt: new Date(),
            deletedById: user.id,
            deleteReason: `แก้ไขเวลาเข้างาน: ${reason}`,
          },
        });
      }

      await auditLogTx(tx, {
        actorId: user.id,
        action: 'attendance.correct-time',
        entityType: 'Attendance',
        entityId: input.attendanceId,
        before: {
          clockInAt: row.clockInAt?.toISOString() ?? null,
          clockOutAt: row.clockOutAt?.toISOString() ?? null,
          lateMinutes: existingLate?.durationMinutes ?? 0,
        },
        after: {
          clockInAt: nextIn.toISOString(),
          clockOutAt: nextOut?.toISOString() ?? null,
          lateMinutes,
          reason,
        },
        metadata: { ...(await reqMeta()), source: 'admin-ui', month },
      });
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof Error && err.message === 'STALE') {
      return { ok: false, message: 'สถานะเปลี่ยนไประหว่างดำเนินการ — กรุณาเปิดใหม่' };
    }
    console.error('[correctAttendanceTime] failed', err);
    return { ok: false, message: 'ระบบขัดข้อง กรุณาลองใหม่' };
  }
}
