/**
 * Undo the auto-`Late` rows that predate the leave-aware lateness fix
 * (2026-07-23). Before it, a check-in on a day the employee had an approved
 * MORNING leave was measured from 09:00, so an afternoon arrival recorded ~3h
 * of bogus lateness (e.g. กมล 15 Jul "3 ชม. 1 นาที", ภัทธริดา 16 Jul "3 ชม. 16
 * นาที" — see check-in.ts / leave-late-context.ts for the live-path fix).
 *
 * For every non-deleted `Late` row on a day the same employee has an approved
 * `OnLeave` row, this RECOMPUTES the correct lateness with the exact same pure
 * helpers the live check-in now uses (`resolveLatePolicy` + `buildLateContext`
 * + `lateMinutesForCheckIn`), then:
 *   - recomputed 0  → soft-deletes the Late row (it was entirely bogus);
 *   - 0 < recomputed < stored → lowers durationMinutes to the correct value;
 *   - recomputed >= stored → leaves it ALONE (this backfill only ever removes
 *     lateness the leave excuses — it never invents or increases a penalty).
 *
 * SAFETY:
 *   - `apply: false` (default) mutates NOTHING — callers use this for a
 *     preview/dry-run.
 *   - NEVER touches a row whose payroll month is already Published/Locked for
 *     that employee — a finalized month's Late count is history. Reported as
 *     action: 'skip-finalized'.
 *   - Soft-delete only (deletedAt + deleteReason), matching the rest of the
 *     app; the row stays auditable. Every mutation writes an AuditLog entry.
 *
 * Two callers share this one core so they can never disagree:
 *   - scripts/backfill-leave-late-rows.ts — CLI, for a human with real DB
 *     creds to dry-run/apply directly.
 *   - src/app/(admin)/admin/tools/backfill-leave-late — Superadmin-gated admin
 *     page (preview → confirm), so the fix can run inside the deployed app
 *     without anyone handling a raw production DB credential.
 *
 * Covered by tests/integration/backfill-leave-late-rows.integration.test.ts
 * against a real Postgres — proves the mutations are exactly right and
 * unrelated rows are never touched.
 */

import type { Prisma } from '@prisma/client';
import { payrollPeriodFor } from '@/lib/advance/period-earnings';
import type { AuditAction, AuditEntityType } from '@/lib/audit/log';
import { prisma } from '@/lib/db/prisma';
import { getLeaveConfig } from '@/lib/leave/leave-config';
import { isClosedDay } from './date';
import { lateMinutesForCheckIn, latePolicyFrom, resolveLatePolicy } from './late-policy';
import { buildLateContext } from './leave-late-context';

/** Same fallback as void.ts / manual/page.tsx when PayrollConfig has no row. */
const DEFAULT_CUTOFF_DAY = 25;

/**
 * Awaited audit write (unlike the app-wide `auditLog`, which is deliberately
 * fire-and-forget). This backfill is invoked from a short-lived CLI process
 * that disconnects Prisma right after `main()` resolves — a detached audit
 * write would race that disconnect and could be silently dropped for a
 * money-adjacent mutation. Same non-throwing safety net as `auditLog`: a
 * failed audit write is logged, never allowed to fail the actual mutation.
 */
async function writeAuditAwaited(params: {
  actorId: string | null;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  before: Prisma.InputJsonValue;
  after: Prisma.InputJsonValue;
  metadata: Prisma.InputJsonValue;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: params.actorId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        beforeValue: params.before,
        afterValue: params.after,
        metadata: params.metadata,
      },
    });
  } catch (err) {
    console.error('[backfill-leave-late] audit write failed', {
      action: params.action,
      entityId: params.entityId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** One planned/applied change to a Late row. */
export type BackfillChange = {
  attendanceId: string;
  employeeId: string;
  date: string; // YYYY-MM-DD
  storedMinutes: number;
  recomputedMinutes: number;
  action: 'delete' | 'lower' | 'skip-finalized' | 'missing-checkin';
  payrollStatus?: 'Published' | 'Locked';
};

export type BackfillReport = {
  changes: BackfillChange[];
  counts: {
    delete: number;
    lower: number;
    skippedFinalized: number;
    missingCheckIn: number;
    unchanged: number;
    /** Rows another actor voided between our read and our write — left alone. */
    skippedConcurrent: number;
  };
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Reads the DB, decides + (when `apply`) writes. Returns a report of every
 * change. `apply=false` (default) mutates NOTHING.
 *
 * `actorId` attributes the mutation (AuditLog.actorId + Attendance.deletedById)
 * to whoever ran it — the Superadmin's user id from the admin page, or `null`
 * for the CLI (no authenticated session there).
 */
export async function backfillLeaveLateRows(
  opts: { apply?: boolean; since?: Date | null; actorId?: string | null } = {},
): Promise<BackfillReport> {
  const apply = opts.apply ?? false;
  const since = opts.since ?? null;
  const actorId = opts.actorId ?? null;

  const [payrollCfg, leaveCfg] = await Promise.all([
    prisma.payrollConfig.findFirst({
      select: { workStartTime: true, lateGraceMinutes: true, cutoffDay: true },
    }),
    getLeaveConfig(),
  ]);
  const cutoffDay = payrollCfg?.cutoffDay ?? DEFAULT_CUTOFF_DAY;

  // Candidate days: every approved OnLeave attendance row. Its (employee, date)
  // is the only place the bug could have fired.
  const onLeave = await prisma.attendance.findMany({
    where: {
      type: 'OnLeave',
      deletedAt: null,
      ...(since ? { date: { gte: since } } : {}),
    },
    select: { employeeId: true, date: true, clockInAt: true, clockOutAt: true },
  });

  const byKey = new Map<string, { employeeId: string; date: Date; rows: typeof onLeave }>();
  for (const r of onLeave) {
    const key = `${r.employeeId}|${iso(r.date)}`;
    const g = byKey.get(key) ?? { employeeId: r.employeeId, date: r.date, rows: [] };
    g.rows.push(r);
    byKey.set(key, g);
  }

  const empIds = [...new Set(onLeave.map((r) => r.employeeId))];
  const employees = await prisma.employee.findMany({
    where: { id: { in: empIds } },
    select: {
      id: true,
      workSchedule: {
        select: { lateToleranceMin: true, days: { select: { dayOfWeek: true, startTime: true } } },
      },
    },
  });
  const empById = new Map(employees.map((e) => [e.id, e]));

  const dateSet = [...new Set(onLeave.map((r) => iso(r.date)))];
  const holidays = await prisma.holiday.findMany({
    where: { date: { in: dateSet.map((d) => new Date(`${d}T00:00:00.000Z`)) }, archivedAt: null },
    select: { date: true },
  });
  const holidaySet = new Set(holidays.map((h) => iso(h.date)));

  const report: BackfillReport = {
    changes: [],
    counts: {
      delete: 0,
      lower: 0,
      skippedFinalized: 0,
      missingCheckIn: 0,
      unchanged: 0,
      skippedConcurrent: 0,
    },
  };

  for (const g of byKey.values()) {
    const emp = empById.get(g.employeeId);
    if (!emp) continue;

    const [lateRow, checkIn] = await Promise.all([
      prisma.attendance.findFirst({
        where: { employeeId: g.employeeId, date: g.date, type: 'Late', deletedAt: null },
        select: { id: true, durationMinutes: true },
      }),
      prisma.attendance.findFirst({
        where: { employeeId: g.employeeId, date: g.date, type: 'CheckIn', deletedAt: null },
        select: { clockInAt: true },
      }),
    ]);
    if (!lateRow) continue; // no penalty that day → nothing to undo

    const stored = lateRow.durationMinutes ?? 0;

    if (!checkIn?.clockInAt) {
      report.counts.missingCheckIn++;
      report.changes.push({
        attendanceId: lateRow.id,
        employeeId: g.employeeId,
        date: iso(g.date),
        storedMinutes: stored,
        recomputedMinutes: stored,
        action: 'missing-checkin',
      });
      continue;
    }

    // Recompute lateness EXACTLY as the live check-in path now does.
    const dow = g.date.getUTCDay();
    const scheduleDays = emp.workSchedule?.days ?? null;
    const hasSchedule = !!scheduleDays && scheduleDays.length > 0;
    const policy = resolveLatePolicy(
      scheduleDays,
      emp.workSchedule?.lateToleranceMin ?? null,
      dow,
      latePolicyFrom(payrollCfg),
    );
    const ctx = buildLateContext(g.rows, leaveCfg);
    let recomputed = policy ? lateMinutesForCheckIn(checkIn.clockInAt, policy, ctx) : 0;
    if (recomputed > 0) {
      const hasHoliday = holidaySet.has(iso(g.date));
      const off = hasSchedule ? hasHoliday : isClosedDay(g.date, hasHoliday);
      if (off) recomputed = 0;
    }

    // This backfill only ever REMOVES lateness the leave excuses.
    if (recomputed >= stored) {
      report.counts.unchanged++;
      continue;
    }

    // Guard: never rewrite a finalized month. Payroll months are CUTOFF-DAY
    // periods, not calendar months (a date past cutoffDay belongs to next
    // month's period) — same mapping void.ts uses for this identical check.
    // A naive calendar-month here would look up the wrong Payroll row for
    // every late-month date and could modify an already-Published period.
    const payrollMonth = payrollPeriodFor(iso(g.date), cutoffDay).end.slice(0, 7);
    const finalized = await prisma.payroll.findFirst({
      where: {
        employeeId: g.employeeId,
        month: payrollMonth,
        status: { in: ['Published', 'Locked'] },
      },
      select: { status: true },
    });
    if (finalized) {
      report.counts.skippedFinalized++;
      report.changes.push({
        attendanceId: lateRow.id,
        employeeId: g.employeeId,
        date: iso(g.date),
        storedMinutes: stored,
        recomputedMinutes: recomputed,
        action: 'skip-finalized',
        payrollStatus: finalized.status as 'Published' | 'Locked',
      });
      continue;
    }

    const action = recomputed === 0 ? 'delete' : 'lower';
    const change: BackfillChange = {
      attendanceId: lateRow.id,
      employeeId: g.employeeId,
      date: iso(g.date),
      storedMinutes: stored,
      recomputedMinutes: recomputed,
      action,
    };

    if (!apply) {
      report.changes.push(change);
      if (action === 'delete') report.counts.delete++;
      else report.counts.lower++;
      continue;
    }

    const reason =
      `leave-excused late backfill (recomputed ${stored}→${recomputed} min, ` +
      `approved OnLeave that day; src/lib/attendance/backfill-leave-late.ts)`;

    // Concurrency guard: re-assert `deletedAt: null` in the WHERE. The
    // soft-delete extension (db/soft-delete-extension.ts) only filters READS,
    // so a bare `update({ where: { id } })` would happily overwrite a row an
    // admin voided in the window between our findFirst and this write —
    // clobbering their deleteReason/deletedById. `updateMany` lets us filter on
    // a non-unique column and tells us whether we actually hit anything.
    const { count } = await prisma.attendance.updateMany({
      where: { id: lateRow.id, deletedAt: null },
      data:
        action === 'delete'
          ? { deletedAt: new Date(), deletedById: actorId ?? undefined, deleteReason: reason }
          : { durationMinutes: recomputed },
    });
    if (count === 0) {
      // Voided by someone else mid-run. Benign: the row is already gone from
      // every payroll read, so there is nothing left for us to correct.
      report.counts.skippedConcurrent++;
      continue;
    }

    report.changes.push(change);
    if (action === 'delete') report.counts.delete++;
    else report.counts.lower++;

    await writeAuditAwaited({
      actorId,
      action: action === 'delete' ? 'attendance.void' : 'attendance.edit',
      entityType: 'Attendance',
      entityId: lateRow.id,
      // Full prior state, so the row is reconstructable from the audit log
      // alone — this is what makes the durationMinutes overwrite reversible.
      before: { durationMinutes: stored, deletedAt: null },
      after:
        action === 'delete'
          ? { deleted: true, durationMinutes: stored, recomputedMinutes: recomputed, reason }
          : { durationMinutes: recomputed, previousMinutes: stored, reason },
      metadata: { source: 'backfill-leave-late-rows' },
    });
  }

  return report;
}
