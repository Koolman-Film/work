/**
 * Payroll run pipeline — gathers a month's inputs, calls the pure calc
 * engine per employee, and manages the Draft → Published → Locked
 * lifecycle on the Payroll rows.
 *
 * Lifecycle contract:
 *   - `runPayrollDraft(month)` may be called any number of times while
 *     rows are Draft (or absent) — it re-gathers and overwrites. It NEVER
 *     touches Published/Locked rows.
 *   - `publishPayroll(month)` re-gathers + recalculates inside ONE
 *     transaction so the published numbers exactly match the rows it
 *     stamps: swept CashAdvance / LeaveRequest rows get
 *     `deductedInPayrollId`, and applied RecurringDeductions get
 *     `monthsRemaining` decremented (endedAt set when it hits 0).
 *     PayrollAdjustments are selected by month-window — idempotent, no
 *     stamping needed.
 *   - `lockPayroll(month)` flips Published → Locked (terminal).
 *
 * Why publish recalculates instead of trusting the Draft numbers: data
 * can change between "คำนวณ" and "เผยแพร่" (an advance approved, an
 * adjustment added). Recomputing in the same transaction that stamps the
 * sweep rows guarantees the slip and the stamps agree.
 */

import { Prisma } from '@prisma/client';
import { bangkokDateUtcMidnight } from '@/lib/attendance/date';
import { deriveAbsentMinutes, scheduledWorkMinutes } from '@/lib/attendance/derive-absence';
import { isScheduledWorkday } from '@/lib/attendance/schedule';
import { prisma } from '@/lib/db/prisma';
import { capLeaveCollection, monthlyLeaveCap } from '@/lib/leave/collection-cap';
import { computeLiveLeaveCharges } from '@/lib/leave/recompute';
import { expandHolidaysWithSubstitutes } from '@/lib/leave/working-days';
import { invalidatePayslipPdf } from '@/lib/payslip/storage';
import { adjustmentAppliesToMonth } from './adjustments';
import {
  type AdjustmentForPayroll,
  type AttendanceForPayroll,
  calcPayroll,
  PayrollCalcError,
  type PayrollDraft,
} from './calc';
import { lockPayrollMonth, withMonthLockRetry } from './month-lock';
import type { PenaltyKindKey, SettlementDays } from './penalty-settlement';
import { loadSettlementsForMonth, type MonthSettlement } from './penalty-settlement-load';
import { payrollMonthWindow } from './period';
import { actualDaysFromAttendance, PENALTY_KINDS } from './reconcile-settlement';

export type SkippedEmployee = {
  employeeId: string;
  name: string;
  reason: string;
};

export type RunResult = {
  calculated: number;
  /**
   * `Payroll.id` of every row this call actually wrote.
   *
   * Exists for the audit trail. `AuditLog.entityId` is `@db.Uuid`, so the
   * month string this action used to log was rejected by Postgres and — since
   * `auditLog` swallows its own errors — dropped silently on every run. A
   * month-wide operation has no single row to point at, so it logs one entry
   * per row it touched, which is also what makes the trail answer "whose
   * payroll changed" rather than just "someone recalculated August".
   *
   * Excludes `frozen` rows: those were deliberately left untouched, and an
   * audit entry claiming otherwise would be a lie in the record.
   */
  calculatedPayrollIds: string[];
  /** Rows left untouched because they are already Published/Locked. */
  frozen: number;
  skipped: SkippedEmployee[];
  /** The month's advisory lock (month-lock.ts) was held by another
   *  publish/draft/settlement transaction right now, so this call did
   *  nothing — `calculated`/`frozen`/`skipped` are all zero/empty. Not an
   *  error: the caller should tell the admin another operation is in
   *  progress and to retry shortly, the same `busy` outcome the settlement
   *  actions (penalty-settlement-admin.ts) return. Additive (rather than a
   *  discriminated union) so every existing caller that already reads
   *  `calculated`/`frozen`/`skipped` unconditionally keeps compiling —
   *  callers that need to distinguish "busy" from "ran, nothing to do"
   *  check this flag explicitly. */
  busy?: true;
};

/** Prisma transaction client — what `$transaction(async (tx) => ...)` passes. */
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Gather every input the calc needs for all non-archived Monthly-paid
 * employees, compute drafts, and report which sweep rows fed each one.
 * Pure read — callers decide what to persist (draft upsert vs publish).
 */
async function gatherAndCalc(db: Tx | typeof prisma, month: string, employeeId?: string) {
  const config = await db.payrollConfig.findFirst();
  if (!config) throw new Error('PayrollConfig missing — run the seed first.');

  // Payroll period = the cutoff window ending on this month's cutoff day
  // (PDF C8). `end` is inclusive of the cutoff day — queries use lte.
  const { start, end } = payrollMonthWindow(month, config.cutoffDay);

  const employees = await db.employee.findMany({
    where: { status: { not: 'Archived' }, ...(employeeId ? { id: employeeId } : {}) },
    select: {
      id: true,
      userId: true,
      firstName: true,
      lastName: true,
      salaryType: true,
      baseSalary: true,
      hasSso: true,
      allowanceAmount: true,
      // For derived absence: never before they were hired, and never for an
      // employee with no schedule (assuming Mon-Sat would charge a day's pay for
      // every real day off).
      hiredAt: true,
      workScheduleId: true,
      workSchedule: {
        select: { days: { select: { dayOfWeek: true, startTime: true, endTime: true } } },
      },
    },
  });
  const empIds = employees.map((e) => e.id);

  const [attendances, advances, recurring, leaveRanges, adjustments, holidays] = await Promise.all([
    db.attendance.findMany({
      where: { employeeId: { in: empIds }, date: { gte: start, lte: end }, deletedAt: null },
      select: { employeeId: true, date: true, type: true, durationMinutes: true },
    }),
    db.cashAdvance.findMany({
      where: {
        employeeId: { in: empIds },
        status: 'Approved',
        isDeducted: false,
        deductedInPayrollId: null,
        deletedAt: null,
      },
      select: { id: true, employeeId: true, amount: true, requestedAt: true },
    }),
    db.recurringDeduction.findMany({
      where: { employeeId: { in: empIds }, endedAt: null, monthsRemaining: { gt: 0 } },
      select: { id: true, employeeId: true, monthlyAmount: true, monthsRemaining: true },
    }),
    // ALL approved leave overlapping the period (any unit, regardless of
    // deductAmount) — used to exempt severe-late days covered by leave (C9).
    db.leaveRequest.findMany({
      where: {
        employeeId: { in: empIds },
        status: 'Approved',
        deletedAt: null,
        startDate: { lte: end },
        endDate: { gte: start },
      },
      select: { employeeId: true, startDate: true, endDate: true },
    }),
    db.payrollAdjustment.findMany({
      where: {
        employeeId: { in: empIds },
        startMonth: { lte: month },
        OR: [{ endMonth: null }, { endMonth: { gte: month } }],
        deletedAt: null,
      },
      select: {
        id: true,
        employeeId: true,
        kind: true,
        amount: true,
        startMonth: true,
        endMonth: true,
      },
    }),
    db.holiday.findMany({ where: { archivedAt: null }, select: { date: true } }),
  ]);

  const byEmp = <T extends { employeeId: string }>(rows: T[]) => {
    const map = new Map<string, T[]>();
    for (const r of rows) {
      const list = map.get(r.employeeId);
      if (list) list.push(r);
      else map.set(r.employeeId, [r]);
    }
    return map;
  };

  // Only sweep เบิก REQUESTED on/before this period's cutoff. A เบิก taken after
  // the cutoff belongs to the NEXT month's payslip — it stays un-swept until a
  // later month picks it up (C8). requestedAt is a full timestamp, so normalise
  // it to its Bangkok calendar date before comparing to `end` (UTC-midnight of
  // the cutoff day) — mirrors how leave windows its live charges by startDate.
  const sweepableAdvances = advances.filter(
    (a) => bangkokDateUtcMidnight(a.requestedAt).getTime() <= end.getTime(),
  );

  const attByEmp = byEmp(attendances);
  const advByEmp = byEmp(sweepableAdvances);
  const recByEmp = byEmp(recurring);
  const adjByEmp = byEmp(adjustments);

  // Leave deductions are derived LIVE from the current entitlement (frozen only
  // at publish), so editing an entitlement is reflected on the next draft with
  // NO manual recompute. Sweep un-paid DeductPay leave whose live over-quota
  // deduction is > 0 and whose startDate is on/before the period cutoff (`end`).
  const outstandingByEmp = new Map<
    string,
    Array<{ id: string; outstanding: number; over: number; full: number }>
  >();
  for (const c of await computeLiveLeaveCharges(empIds)) {
    if (c.swept) continue; // already paid in a published payroll — never re-sweep
    if (c.startDate.getTime() > end.getTime()) continue;
    if (c.deductAmount == null || c.deductAmount <= 0) continue;
    // What is still OWED, not the whole charge: a previous month may have
    // collected part of it under the cap.
    const outstanding = c.deductAmount - c.deductedAmountToDate;
    if (outstanding <= 0) continue;
    const list = outstandingByEmp.get(c.employeeId) ?? [];
    list.push({
      id: c.leaveRequestId,
      outstanding,
      over: c.overQuotaMinutes,
      full: c.deductAmount,
    });
    outstandingByEmp.set(c.employeeId, list);
  }

  // Apply the monthly ceiling per employee. Without it the whole backlog lands
  // in whichever month runs next — a ฿13,500 salary meeting a ฿27,450 deduction
  // is what prompted this (2026-08-03). A request larger than the cap is
  // collected PARTIALLY; whole-request-only would skip it every month forever.
  const liveSweepableByEmp = new Map<
    string,
    Array<{ id: string; deduct: number; over: number; fullySettled: boolean; full: number }>
  >();
  for (const emp of employees) {
    const list = outstandingByEmp.get(emp.id);
    if (!list?.length) continue;
    const cap = monthlyLeaveCap(Number(emp.baseSalary), config.leaveDeductMaxPercent ?? 0);
    const byId = new Map(list.map((l) => [l.id, l]));
    liveSweepableByEmp.set(
      emp.id,
      capLeaveCollection(list, cap).map((c) => ({
        id: c.id,
        deduct: c.collect,
        over: byId.get(c.id)?.over ?? 0,
        fullySettled: c.fullySettled,
        full: byId.get(c.id)?.full ?? c.collect,
      })),
    );
  }

  // Per-employee set of leave-covered dates within the window — a severe late
  // on one of these is exempt from its 1-day penalty (C9). @db.Date values are
  // UTC midnight, so stepping by 86_400_000ms is exact (no DST in UTC).
  const leaveDatesByEmp = new Map<string, Set<string>>();
  for (const r of leaveRanges) {
    let set = leaveDatesByEmp.get(r.employeeId);
    if (!set) {
      set = new Set<string>();
      leaveDatesByEmp.set(r.employeeId, set);
    }
    const from = Math.max(r.startDate.getTime(), start.getTime());
    const to = Math.min(r.endDate.getTime(), end.getTime());
    for (let t = from; t <= to; t += 86_400_000) {
      set.add(new Date(t).toISOString().slice(0, 10));
    }
  }

  // ── Derived absence ──────────────────────────────────────────────────────
  // Days the employee was scheduled, did not check in, had no approved leave,
  // and no admin keyed an Absent row for. Whole days only (see
  // deriveAbsentMinutes). OFF entirely when config.absenceDerivedFrom is null,
  // which is its state until someone deliberately sets it — so this block is a
  // no-op for every existing installation.
  const derivedAbsentByEmp = new Map<string, number>();
  if (config.absenceDerivedFrom) {
    const holidaySet = new Set(
      expandHolidaysWithSubstitutes(holidays.map((h) => h.date)).map((d) =>
        d.toISOString().slice(0, 10),
      ),
    );
    const leaveCfg = (await db.leaveConfig.findFirst()) ?? {
      morningStart: '09:00',
      morningEnd: '12:00',
      afternoonStart: '13:00',
      afternoonEnd: '17:00',
    };
    // A schedule window is wall-clock and includes the unpaid break; a leave day
    // excludes it. Removing it here keeps the two on one basis.
    const brk =
      leaveCfg.afternoonStart > leaveCfg.morningEnd
        ? { start: leaveCfg.morningEnd, end: leaveCfg.afternoonStart }
        : null;
    // Never derive a day that has not happened yet: the window runs to the
    // cutoff, which for most of the month is in the future, and a future
    // workday has no check-in for the obvious reason.
    //
    // CONSEQUENCE, and it is a real one: publishPayroll re-runs gatherAndCalc,
    // so a month drafted on the 20th and published on the 27th derives MORE
    // days than the draft showed — the extra days genuinely happened in
    // between, but nobody keyed anything to cause the change. Attendance-driven
    // deductions have always moved between draft and publish; what is new is
    // that the passage of time alone can move this one. Draft late, or expect
    // the published figure to exceed a mid-month draft.
    const todayYmd = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
    const cutoffYmd = config.absenceDerivedFrom.toISOString().slice(0, 10);

    for (const emp of employees) {
      if (!emp.workScheduleId || !emp.workSchedule) continue; // never guess a schedule
      const minutesByDow = new Map<number, number>(
        emp.workSchedule.days.map((d) => [
          d.dayOfWeek,
          scheduledWorkMinutes(d.startTime, d.endTime, brk),
        ]),
      );
      const dows = [...minutesByDow.keys()];
      const leaveDates = leaveDatesByEmp.get(emp.id) ?? new Set<string>();
      const keyed = new Set<string>();
      const checked = new Set<string>();
      for (const a of attByEmp.get(emp.id) ?? []) {
        const ymdA = a.date.toISOString().slice(0, 10);
        if (a.type === 'CheckIn') checked.add(ymdA);
        else if (a.type === 'Absent') keyed.add(ymdA);
      }

      const hiredYmd = emp.hiredAt.toISOString().slice(0, 10);
      let days = 0;
      for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
        const d = new Date(t);
        const ymdD = d.toISOString().slice(0, 10);
        // `>=` today, not `>`: a day is only assessable once it is OVER. Until
        // then "no check-in yet" is not absence — it is the morning. Found at
        // 00:08 on 2026-09-04, when this derived an absence for 47 of 48
        // employees because nobody had clocked in yet that day.
        if (ymdD < cutoffYmd || ymdD < hiredYmd || ymdD >= todayYmd) continue;
        const minutes = deriveAbsentMinutes({
          scheduledMinutes: minutesByDow.get(d.getUTCDay()) ?? 0,
          leaveMinutes: leaveDates.has(ymdD) ? 1 : 0, // any leave exempts the day
          // Any CheckIn row counts as turning up, including one an admin later
          // marked Rejected (a disputed location, not proof of absence).
          // Deriving a full day's charge off a geofence dispute would be the
          // wrong direction; if they really were absent, the admin keys an
          // Absent row, which wins outright.
          hasCheckIn: checked.has(ymdD),
          hasManualAbsent: keyed.has(ymdD),
          isWorkday: isScheduledWorkday(dows, d.getUTCDay(), holidaySet.has(ymdD)),
        });
        if (minutes > 0) days++;
      }
      if (days > 0) derivedAbsentByEmp.set(emp.id, days);
    }
  }

  // What each employee's Absent/LateThreeStrike/SevereLate penalties were
  // settled with this month (read-only — see penalty-settlement-load.ts).
  // Loaded once for the whole run, then looked up per employee below. Kept on
  // each draft entry (not just fed into calc) so payslip assembly downstream
  // can also read `leaveTypeNames` for display.
  const settlements = await loadSettlementsForMonth(month, db);

  const drafts: Array<{
    draft: PayrollDraft;
    employee: (typeof employees)[number];
    sweptAdvanceIds: string[];
    sweptLeaves: Array<{
      id: string;
      deduct: number;
      over: number;
      fullySettled: boolean;
      full: number;
    }>;
    appliedRecurring: Array<{ id: string; monthsRemaining: number }>;
    settlement: MonthSettlement | undefined;
  }> = [];
  const skipped: SkippedEmployee[] = [];

  for (const emp of employees) {
    const empAdvances = advByEmp.get(emp.id) ?? [];
    const empRecurring = recByEmp.get(emp.id) ?? [];
    const empSweep = liveSweepableByEmp.get(emp.id) ?? [];
    // The SQL range pre-filter is correct on its own; the in-memory check
    // is defense-in-depth + the single source of truth for the rule.
    const empAdjustments = (adjByEmp.get(emp.id) ?? []).filter((a) =>
      adjustmentAppliesToMonth(a, month),
    );

    try {
      const draft = calcPayroll({
        employee: {
          id: emp.id,
          salaryType: emp.salaryType,
          baseSalary: emp.baseSalary.toString(),
          hasSso: emp.hasSso,
          allowanceAmount: emp.allowanceAmount.toString(),
        },
        attendances: (attByEmp.get(emp.id) ?? []).map(
          (a): AttendanceForPayroll => ({
            date: a.date,
            type: a.type as AttendanceForPayroll['type'],
            durationMinutes: a.durationMinutes,
          }),
        ),
        advances: empAdvances.map((a) => ({ amount: a.amount.toString() })),
        recurringDeductions: empRecurring.map((r) => ({
          monthlyAmount: r.monthlyAmount.toString(),
        })),
        leaveDeductions: empSweep.map((l) => ({ amount: l.deduct.toString() })),
        leaveDates: [...(leaveDatesByEmp.get(emp.id) ?? [])],
        derivedAbsentDays: derivedAbsentByEmp.get(emp.id) ?? 0,
        penaltySettlement: settlements.get(emp.id)?.days,
        adjustments: empAdjustments.map(
          (a): AdjustmentForPayroll => ({ kind: a.kind, amount: a.amount.toString() }),
        ),
        config: {
          ssoRate: config.ssoRate.toString(),
          ssoSalaryCap: config.ssoSalaryCap.toString(),
          ssoAmountCap: config.ssoAmountCap.toString(),
          absentDeductionPerDay: config.absentDeductionPerDay.toString(),
          lateDeduction: config.lateDeduction.toString(),
          earlyLeaveDeduction: config.earlyLeaveDeduction.toString(),
          lateThreeStrikeEnabled: config.lateThreeStrikeEnabled,
          lateThreeStrikeCount: config.lateThreeStrikeCount,
          severeLateEnabled: config.severeLateEnabled,
          severeLateThresholdMin: config.severeLateThresholdMin,
          workingDaysPerMonth: config.workingDaysPerMonth,
        },
        month,
      });
      drafts.push({
        draft,
        employee: emp,
        sweptAdvanceIds: empAdvances.map((a) => a.id),
        sweptLeaves: empSweep,
        appliedRecurring: empRecurring.map((r) => ({
          id: r.id,
          monthsRemaining: r.monthsRemaining,
        })),
        settlement: settlements.get(emp.id),
      });
    } catch (err) {
      if (err instanceof PayrollCalcError) {
        skipped.push({
          employeeId: emp.id,
          name: `${emp.firstName} ${emp.lastName}`,
          reason: err.detail.kind,
        });
        continue;
      }
      throw err;
    }
  }

  return { drafts, skipped };
}

/**
 * Live actual penalty days for ONE employee's month — Absent /
 * LateThreeStrike / SevereLate, read off a fresh (unpersisted) recompute of
 * just that employee's attendance, the same way the reconcile page's
 * over-settlement chip does (`actualDaysFromAttendance`, reconcile-
 * settlement.ts). Scoped by `employeeId` through `gatherAndCalc`'s existing
 * per-employee filter (already used by `payrollRowDetailRaw`/
 * `payrollRowDetail` below for the same "recompute one row" cost) — this is
 * NOT a full-month recompute; it touches only this employee's attendance,
 * overlapping leave, and the small global config/holiday tables.
 *
 * Two callers:
 *   - `setPenaltySettlement` (penalty-settlement-admin.ts) — refuses to
 *     settle more days than the penalty actually justifies (`exceeds-
 *     penalty`), inside the same locked transaction, so `db` must be the
 *     active `tx`.
 *   - `publishPayroll` below doesn't need to call this separately — it
 *     already computes every publishing employee's breakdown as part of its
 *     normal drafts loop, so it reads `actualDaysFromAttendance` straight off
 *     that instead of a second recompute.
 *
 * Returns null when the employee has no calculable draft for the month (not
 * found, archived, or a salary type payroll can't charge) — callers treat
 * that as "nothing to compare," not as zero.
 */
export async function actualPenaltyDaysForEmployee(
  db: Tx | typeof prisma,
  month: string,
  employeeId: string,
): Promise<SettlementDays | null> {
  const { drafts } = await gatherAndCalc(db, month, employeeId);
  const entry = drafts[0];
  return entry ? actualDaysFromAttendance(entry.draft.breakdown.attendance) : null;
}

/** Serialize a PayrollDraft's Decimals into Prisma write values. */
function draftValues(draft: PayrollDraft) {
  return {
    incomeBase: new Prisma.Decimal(draft.incomeBase.toFixed(2)),
    incomeAllowance: new Prisma.Decimal(draft.incomeAllowance.toFixed(2)),
    incomeOther: new Prisma.Decimal(draft.incomeOther.toFixed(2)),
    deductSso: new Prisma.Decimal(draft.deductSso.toFixed(2)),
    deductAdvance: new Prisma.Decimal(draft.deductAdvance.toFixed(2)),
    deductAttendance: new Prisma.Decimal(draft.deductAttendance.toFixed(2)),
    deductLeave: new Prisma.Decimal(draft.deductLeave.toFixed(2)),
    deductDebt: new Prisma.Decimal(draft.deductDebt.toFixed(2)),
    deductOther: new Prisma.Decimal(draft.deductOther.toFixed(2)),
    netPay: new Prisma.Decimal(draft.netPay.toFixed(2)),
  };
}

/**
 * Recompute fresh draft numbers per employee WITHOUT persisting — for the
 * payroll page's stale-draft check. Compares against the stored Draft rows to
 * flag ones whose inputs (attendance / leave / advance / adjustments / config /
 * salary) changed since the last "คำนวณ". Same engine `runPayrollDraft` uses, so
 * a flagged row is exactly one that would change on recalculation.
 */
export async function previewPayrollDrafts(month: string): Promise<Map<string, PayrollDraft>> {
  const { drafts } = await gatherAndCalc(prisma, month);
  return new Map(drafts.map((d) => [d.employee.id, d.draft]));
}

/**
 * Calculate (or recalculate) Draft payroll rows for the month. Existing
 * Published/Locked rows are left untouched and counted as `frozen`.
 *
 * Runs inside the month's advisory lock (`lockPayrollMonth`, same as
 * `publishPayroll`) so a recalculation and a publish can never interleave.
 * Without this, this function's `row.status !== 'Draft'` guard reads a
 * snapshot BEFORE the write below — if a `publishPayroll` for the same
 * month commits in between, the row is now Published, but this function's
 * write still lands (its snapshot said Draft) and flips it straight back to
 * Draft. That reopens `isPeriodClosed` (penalty-settlement-admin.ts) on a
 * month whose payslip may already be issued and downloaded, defeating the
 * "published payroll is immutable" invariant the whole feature rests on.
 * This branch added two new callers that make the race easy to hit in
 * practice: `setReconcileSettlement`/`clearReconcileSettlement`
 * (admin/payroll/reconcile/actions.ts) both call this function immediately
 * after a settlement commits, OUTSIDE any lock of their own — exactly the
 * moment an admin is likely to be pressing publish on the same month.
 *
 * Two complementary measures, deliberately both applied (see the PR
 * description this shipped with):
 *   1. The lock below closes the race at the source — a publish and a
 *      recalculation for the same month simply cannot run concurrently.
 *   2. The per-row write is ALSO scoped to `status: 'Draft'`
 *      (`updateMany`, not an unconditional `upsert.update`) so it is
 *      structurally impossible for this function to touch a non-Draft row
 *      even if the lock were somehow bypassed by a future refactor. Belt
 *      and braces: (1) is what actually prevents the race day-to-day, (2)
 *      is what keeps a regression from being catastrophic if (1) is ever
 *      weakened.
 *
 * Deadlock: safe. This takes ONLY the month lock — same single-key shape as
 * `publishPayroll`, which also takes only the month lock. Neither this
 * function nor `publishPayroll` ever also holds the leave-entitlement lock
 * (`lockEntitlement`, leave/balance.ts) that `setPenaltySettlement` and
 * `approveLeaveRequest` use, so there is no second lock for an ordering
 * cycle to form around.
 *
 * Transaction timeout: explicit `timeout`/`maxWait` below, NOT the Prisma
 * default (5s timeout / 2s maxWait). `lockPayrollMonth` is non-blocking
 * (`pg_try_advisory_xact_lock` — see month-lock.ts), so `timeout` no longer
 * has to absorb an unbounded wait behind some OTHER admin's transaction on
 * this same month — it only has to cover THIS transaction's own work:
 * `gatherAndCalc`'s bulk reads plus one DB round trip per employee (the
 * `updateMany`/`create` in the loop below). At real company scale (~48
 * employees) that is a modest, boundable number of sequential round trips
 * even on a non-local Postgres connection — 10s (down from the previous
 * 20s, which was sized to also cover an unbounded queue wait that no longer
 * exists now that the lock acquire can't block) leaves comfortable
 * headroom. `publishPayroll` does strictly MORE per-employee work per
 * transaction (an upsert plus conditional advance/leave/recurring-deduction
 * writes) than this function, so it is given a larger budget — see its own
 * "Transaction timeout" note.
 */
export async function runPayrollDraft(month: string): Promise<RunResult> {
  return prisma.$transaction(
    async (tx) => {
      // Lock FIRST, before gatherAndCalc or the `existing` read below — same
      // ordering rule as publishPayroll/setPenaltySettlement (month-lock.ts):
      // the lock only closes the race if every read that decides what to
      // write happens after it, not merely somewhere inside the transaction.
      // Non-blocking: `false` means another admin's draft/publish/settle
      // transaction holds the lock right now. Return `busy` immediately —
      // do NOT fall through to gatherAndCalc/writes, which would then run
      // unprotected by the lock this function's whole safety argument rests
      // on.
      const acquired = await lockPayrollMonth(tx, month);
      if (!acquired)
        return {
          calculated: 0,
          calculatedPayrollIds: [],
          frozen: 0,
          skipped: [],
          busy: true as const,
        };

      const { drafts, skipped } = await gatherAndCalc(tx, month);

      const existing = await tx.payroll.findMany({
        where: { month },
        select: { id: true, employeeId: true, status: true },
      });
      const existingByEmp = new Map(existing.map((p) => [p.employeeId, p]));

      let calculated = 0;
      let frozen = 0;
      const calculatedPayrollIds: string[] = [];

      for (const { draft, employee } of drafts) {
        const row = existingByEmp.get(employee.id);
        if (row && row.status !== 'Draft') {
          frozen++;
          continue;
        }

        if (row) {
          // `status: 'Draft'` in the `where` (measure 2 above) is what makes
          // this structurally unable to overwrite a non-Draft row, even if
          // the lock above were somehow bypassed. `count === 0` means the
          // row's status changed out from under the snapshot taken above —
          // shouldn't happen while the lock is held, but if it ever does,
          // treat it the same as `frozen` rather than silently no-op-ing.
          const result = await tx.payroll.updateMany({
            where: { id: row.id, status: 'Draft' },
            data: draftValues(draft),
          });
          if (result.count > 0) {
            calculated++;
            calculatedPayrollIds.push(row.id);
          } else {
            frozen++;
          }
        } else {
          const created = await tx.payroll.create({
            data: { employeeId: employee.id, month, status: 'Draft', ...draftValues(draft) },
            select: { id: true },
          });
          calculated++;
          calculatedPayrollIds.push(created.id);
        }
      }

      return { calculated, calculatedPayrollIds, frozen, skipped };
    },
    // See "Transaction timeout" above. `maxWait` (5s, the Prisma default) is
    // ONLY the budget to acquire a connection from the pool BEFORE this
    // interactive transaction even opens — unaffected by month-lock
    // contention either way. `timeout` (10s) now only has to cover THIS
    // transaction's own work (bulk reads + up to ~48 sequential per-employee
    // writes), because `lockPayrollMonth` can no longer block: it returns
    // immediately, `busy` on contention (see month-lock.ts and the `busy`
    // check above). (Previously 10s maxWait / 20s timeout, sized to also
    // absorb an unbounded wait behind another admin's concurrent
    // publish/recalculate — that budget kept getting reopened by one more
    // concurrent caller than the last bump covered; removing the wait from
    // the budget instead of re-guessing its size is the actual fix.)
    { maxWait: 5_000, timeout: 10_000 },
  );
}

export type PublishedSlip = {
  payrollId: string;
  employeeId: string;
  recipientUserId: string;
  employeeFirstName: string;
  /** "12,500.00" — pre-formatted for the LINE Flex payload. */
  netPay: string;
};

/**
 * One employee's stranded settlement: a live penalty settlement whose kind
 * settled MORE days than this month's actual penalty now justifies. This is
 * how Defect 3 (a settlement outliving the penalty it was justified by — a
 * late-penalty rule toggled off, an attendance row voided, an absence
 * corrected) is caught BEFORE `publishPayroll` freezes the month: once
 * Published, `isPeriodClosed` makes the settlement uneditable forever, so
 * this is the last moment a human can still clear or adjust it.
 */
export type BlockedSettlement = {
  employeeId: string;
  name: string;
  kind: PenaltyKindKey;
  actualDays: number;
  settledDays: number;
};

/**
 * One employee whose net pay came out below zero — deductions exceeded
 * everything they earned this month.
 *
 * calc.ts computes this without complaint on purpose ("we allow negative … but
 * surface it as an error case the caller can choose to handle — typically by
 * capping at zero AND alerting the admin") and declares `CalcError` variant
 * `negative-net` for it. That variant was never thrown anywhere: the only
 * handling that existed was the payroll table colouring the figure red. A
 * negative row published exactly like any other.
 *
 * It must not. Publishing issues a payslip stating the company will take money
 * FROM the employee, stamps every swept leave request `deductedInPayrollId` —
 * frozen, per docs/runbooks/penalty-settled-with-leave.md — and sends it over
 * LINE. Whatever produced the number (a leave backlog landing in one month is
 * the known way), it needs a human before it becomes a document.
 *
 * Held back per-employee, exactly like a stranded settlement: the row stays in
 * Draft where it is still fixable, and everyone else in the month publishes.
 */
export type BlockedNegativeNet = {
  employeeId: string;
  name: string;
  /** The computed net, as a string, e.g. "-14625.00". */
  netPay: string;
};

export type PublishResult = {
  published: PublishedSlip[];
  skipped: SkippedEmployee[];
  /** Employees this call held back — see the guard in `publishPayroll`
   *  below. Everyone else in `published` still went through: a non-empty
   *  `blocked` no longer means the whole call published nothing, only that
   *  these specific employees were skipped. Each stays in Draft, so the
   *  admin can clear or adjust the settlement (reconcile page) and publish
   *  them afterward — the whole-month retry or a per-employee retry both
   *  work. */
  blocked: BlockedSettlement[];
  /** Employees held back for a negative net (see `BlockedNegativeNet`). A
   *  separate list rather than a `reason` discriminant on `blocked`, for the
   *  same reason as `busy` below: every existing caller that reads
   *  `result.blocked` keeps compiling and keeps showing the settlement-specific
   *  message it already shows, instead of silently mislabelling a negative-net
   *  hold-back as a stranded settlement. Required, not optional — the compiler
   *  then names every construction site rather than letting one default to
   *  empty and quietly publish a negative row. */
  blockedNegativeNet: BlockedNegativeNet[];
  /** Same `busy` outcome as `RunResult` (see above, run.ts) — the month's
   *  advisory lock was held by another transaction right now, so this call
   *  did nothing (`published`/`blocked` are both empty). Additive rather
   *  than a discriminated union for the same reason as `RunResult.busy`:
   *  every existing caller that reads `result.published`/`result.blocked`
   *  unconditionally keeps compiling. */
  busy?: true;
};

/**
 * Publish the month: recalculate inside one transaction, persist as
 * Published, stamp swept rows, decrement recurring deductions. Employees
 * whose row is already Published/Locked are silently left as-is (their
 * stamps were made when they were first published). Employees carrying a
 * stranded penalty settlement (see `BlockedSettlement` above) are held back
 * and left in Draft — everyone else in scope still publishes; see
 * `result.blocked` for who was skipped and why.
 *
 * Caller is responsible for writing the audit log. There is no automatic
 * per-employee LINE push on publish anymore — employees read their slip
 * from the LINE rich menu instead (quota reduction; see
 * admin-daily-digest.ts for what admins still get pushed).
 */
export async function publishPayroll(
  month: string,
  opts?: { employeeId?: string },
): Promise<PublishResult> {
  // Wrapped in a couple of short retries (withMonthLockRetry, month-lock.ts):
  // unlike `runPayrollDraft`, this transaction's own work is often just as
  // quick as a settlement's (the common case — `opts.employeeId` set, the
  // per-row "เผยแพร่" button, or a small month), so it races head-to-head
  // against `setPenaltySettlement`/`clearPenaltySettlement` about as often as
  // it races against another `runPayrollDraft` — see month-lock.ts's
  // doc-comment on `withMonthLockRetry` for the full reasoning and why
  // `runPayrollDraft` deliberately does NOT get this treatment.
  const result = await withMonthLockRetry(
    () =>
      prisma.$transaction(
        async (tx) => {
          // Take the month's advisory lock BEFORE gatherAndCalc reads settlements
          // (and everything else). This closes the race against
          // setPenaltySettlement/clearPenaltySettlement (penalty-settlement-admin.ts),
          // which take the SAME lock (see ./month-lock.ts) before checking whether
          // the month is still Draft: without a lock here, a settle transaction
          // could start after our gatherAndCalc read, find the month still open,
          // and commit its settlement — which our already-taken snapshot would
          // never see — right before we stamp the row Published.
          //
          // Keyed on the MONTH, not on a Payroll row: this upsert's `create`
          // branch (below) can write a Payroll row that did not exist when this
          // transaction started — an employee added or activated between
          // "คำนวณ" and "เผยแพร่", reachable through the manual attendance form,
          // which settles without requiring a Draft row first. A row lock (the
          // previous version of this code, `SELECT ... FOR UPDATE`) locks nothing
          // when no row matches, so that case wasn't protected at all — see
          // month-lock.ts for the full failure mode this replaced (Finding 1 of
          // the review that added it). Used unconditionally, even when
          // `opts.employeeId` scopes this publish to one employee, so both this
          // function and penalty-settlement-admin.ts always compute the same lock
          // key and can never pick different ones and miss each other.
          //
          // The lock must be taken HERE, before gatherAndCalc, not after — that
          // ordering is the entire point:
          //   - a settle that starts after us now FAILS to acquire this lock
          //     (busy) until we commit, then retries and correctly sees the row
          //     is no longer Draft (`period-closed`);
          //   - a settle already in flight means WE fail to acquire it (busy) —
          //     we abort via the `acquired` check below rather than read
          //     anything, so gatherAndCalc's read never runs against a
          //     snapshot that a concurrent settlement could still change out
          //     from under.
          // Either ordering now yields a consistent result: whichever side loses
          // the race gets `busy` and stops immediately, never a stale read. (This
          // used to be phrased as "blocks until the other commits" — that was
          // true when the lock was blocking; `lockPayrollMonth` is now
          // non-blocking, see month-lock.ts, so the losing side aborts instead
          // of waiting. The safety property — the loser never proceeds on a
          // stale snapshot — is unchanged.) A future refactor that moves this
          // lock after gatherAndCalc (or moves the read earlier) would silently
          // reopen the race — don't. Likewise, don't "simplify" this back to a
          // row lock — see month-lock.ts for why that is unsafe.
          //
          // A single advisory lock per transaction can't deadlock against itself:
          // there's exactly one key per publish, so the old employeeId-ordering
          // concern for the row-lock version of this code no longer applies.
          const acquired = await lockPayrollMonth(tx, month);
          if (!acquired)
            return {
              published: [],
              skipped: [],
              blocked: [],
              blockedNegativeNet: [],
              busy: true as const,
            };

          const { drafts, skipped } = await gatherAndCalc(tx, month, opts?.employeeId);

          // Read BEFORE the guard below, not after: the guard must only assess
          // employees this publish would actually write (row absent or Draft) —
          // exactly what `existingByEmp` decides for the write loop further down.
          const existing = await tx.payroll.findMany({
            where: { month },
            select: { id: true, employeeId: true, status: true },
          });
          const existingByEmp = new Map(existing.map((p) => [p.employeeId, p]));

          // Defect 3 guard: hold back any employee THIS PUBLISH WOULD WRITE (row
          // absent or Draft) whose live settlement outlived its penalty (e.g.
          // `lateThreeStrikeEnabled` was switched off after the settlement was
          // made — see calc.ts:tier1LateMoney — or an attendance row was voided,
          // or an absence was corrected). `draft.breakdown.attendance` was just
          // computed above for every employee in `drafts`, so this reuses that —
          // no second recompute, and NOT a per-settle-call cost the way
          // `actualPenaltyDaysForEmployee` is for `setPenaltySettlement`.
          //
          // A row that is already Published/Locked is skipped here WITHOUT being
          // assessed at all: this publish is a no-op for that employee either way
          // (the write loop below never touches it), so a stranded settlement of
          // theirs isn't something this call could freeze — there's nothing left
          // for it to do to that row.
          //
          // Per-employee skip, not a whole-month hard stop: calc.ts must stay pure
          // (it cannot release the settlement itself), and once Published,
          // `isPeriodClosed` makes the settlement uneditable forever — publishing
          // it is the one irreversible step, so holding back just that employee
          // (leaving their row in Draft) is what keeps them fixable afterward.
          // Stopping the WHOLE month instead would destroy that same property for
          // every OTHER employee too, for no benefit to the stranded one — see the
          // fix-publish-lockout report for the production incident this replaced.
          // Checked BEFORE any write below, so a held-back employee is never
          // partially published.
          const blocked: BlockedSettlement[] = [];
          const blockedNegativeNet: BlockedNegativeNet[] = [];
          const blockedEmployeeIds = new Set<string>();
          for (const { draft, employee } of drafts) {
            const row = existingByEmp.get(employee.id);
            if (row && row.status !== 'Draft') continue; // not writable by this call — not assessed

            const actualDays = actualDaysFromAttendance(draft.breakdown.attendance);
            const settledDays = draft.breakdown.attendance.settledDays;
            for (const kind of PENALTY_KINDS) {
              if (settledDays[kind] > actualDays[kind]) {
                blocked.push({
                  employeeId: employee.id,
                  name: `${employee.firstName} ${employee.lastName}`,
                  kind,
                  actualDays: actualDays[kind],
                  settledDays: settledDays[kind],
                });
                blockedEmployeeIds.add(employee.id);
              }
            }

            // Deductions exceeded everything earned. Zero is fine — that is a
            // month fully consumed by legitimate deductions — but below zero the
            // slip would tell the employee they owe the company, and publishing
            // freezes the leave that produced it. Held back for a human.
            if (draft.netPay.isNegative()) {
              blockedNegativeNet.push({
                employeeId: employee.id,
                name: `${employee.firstName} ${employee.lastName}`,
                netPay: draft.netPay.toFixed(2),
              });
              blockedEmployeeIds.add(employee.id);
            }
          }

          const published: PublishedSlip[] = [];

          for (const {
            draft,
            employee,
            sweptAdvanceIds,
            sweptLeaves,
            appliedRecurring,
          } of drafts) {
            if (blockedEmployeeIds.has(employee.id)) continue; // stranded — held back, left in Draft (see guard above)
            const row = existingByEmp.get(employee.id);
            if (row && row.status !== 'Draft') continue; // already published/locked

            const saved = await tx.payroll.upsert({
              where: { employeeId_month: { employeeId: employee.id, month } },
              create: {
                employeeId: employee.id,
                month,
                status: 'Published',
                publishedAt: new Date(),
                ...draftValues(draft),
              },
              update: { status: 'Published', publishedAt: new Date(), ...draftValues(draft) },
            });

            if (sweptAdvanceIds.length > 0) {
              await tx.cashAdvance.updateMany({
                where: { id: { in: sweptAdvanceIds }, deductedInPayrollId: null },
                data: { deductedInPayrollId: saved.id, isDeducted: true },
              });
            }
            // FREEZE the live-computed over-quota deduction onto each swept leave.
            // Once paid it must never move again, so we persist the exact value that
            // entered this payroll alongside the `deductedInPayrollId` stamp. The
            // `deductedInPayrollId: null` guard keeps this idempotent on re-publish.
            for (const l of sweptLeaves) {
              // `l.deduct` is what THIS month collected, which under the monthly
              // cap may be only part of the request. So the collected-to-date
              // total is incremented rather than overwritten, and
              // deductedInPayrollId — the "this is paid, never recompute it"
              // stamp — is set ONLY when the request is fully settled. Stamping
              // a partially collected request would freeze it at the instalment
              // and silently forgive the remainder.
              await tx.leaveRequest.updateMany({
                where: { id: l.id, deductedInPayrollId: null },
                data: {
                  ...(l.fullySettled
                    ? {
                        deductedInPayrollId: saved.id,
                        // Freeze the FULL charge, not the final instalment.
                        deductAmount: new Prisma.Decimal(l.full.toFixed(2)),
                        overQuotaMinutes: l.over,
                      }
                    : {}),
                  deductedAmountToDate: { increment: new Prisma.Decimal(l.deduct.toFixed(2)) },
                },
              });
            }
            for (const rec of appliedRecurring) {
              const remaining = rec.monthsRemaining - 1;
              await tx.recurringDeduction.update({
                where: { id: rec.id },
                data: {
                  monthsRemaining: remaining,
                  ...(remaining <= 0 ? { endedAt: new Date() } : {}),
                },
              });
            }

            published.push({
              payrollId: saved.id,
              employeeId: employee.id,
              recipientUserId: employee.userId,
              employeeFirstName: employee.firstName,
              netPay: draft.netPay.toNumber().toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              }),
            });
          }

          return { published, skipped, blocked, blockedNegativeNet };
        },
        // Explicit budget, larger than `runPayrollDraft`'s (see that function's
        // "Transaction timeout" note): `lockPayrollMonth` is non-blocking now, so
        // neither `maxWait` (pool acquisition, unaffected by lock contention
        // either way) nor `timeout` has to absorb a wait behind another admin's
        // transaction — `timeout` only has to cover THIS transaction's own work.
        // This function does strictly MORE per-employee work per transaction
        // than `runPayrollDraft` (an upsert plus conditional advance/leave/
        // recurring-deduction writes, not just one `updateMany`/`create`), so
        // its `timeout` is sized larger — 15s vs. 10s. (Previously 10s maxWait /
        // 30s timeout, sized to also absorb an unbounded wait behind a
        // concurrent `runPayrollDraft` holding the lock up to its own old 20s
        // budget — that arms race is exactly what removing the wait from the
        // budget, instead of re-guessing its size, ends.)
        { maxWait: 5_000, timeout: 15_000 },
      ),
    (result) => result.busy === true,
  );

  // Bust any cached PDF for freshly-published slips so a download reflects the
  // finalized numbers. Fire-and-forget: a Storage hiccup must never fail publish.
  // (No-op when `busy`: `published` is empty in that case.)
  for (const slip of result.published) {
    void invalidatePayslipPdf(slip.employeeId, month).catch(() => {});
  }

  return result;
}

/** Flip every Published row of the month to Locked. Returns count. */
/**
 * Flip every Published row for the month to Locked, and return the ids of the
 * rows actually locked.
 *
 * Returns ids rather than a count because the caller audits this, and
 * `AuditLog.entityId` is `@db.Uuid` — a month string is rejected by Postgres
 * and silently dropped. `updateManyAndReturn` gets both in one statement, so
 * there is no window between choosing the rows and writing them.
 */
export async function lockPayroll(month: string): Promise<string[]> {
  const rows = await prisma.payroll.updateManyAndReturn({
    where: { month, status: 'Published' },
    data: { status: 'Locked' },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export type SerializedBreakdown = {
  sso: {
    cappedBase: string;
    rate: string;
    rawAmount: string;
    amountCap: string;
    applied: string;
    capped: boolean;
  };
  attendance: {
    absent: {
      count: number;
      perDay: string;
      money: string;
      /** Days of this penalty settled with leave instead of money (see penalty-settlement.ts). */
      settledDays: number;
      /** Which leave type absorbed the settlement, when `settledDays > 0`. */
      leaveTypeName: string | null;
    };
    lateTier1: {
      mode: 'threeStrike' | 'flat';
      count: number;
      threeStrikeCount?: number;
      days?: number;
      perUnit: string;
      money: string;
      /** Only meaningful in 'threeStrike' mode — a flat-mode late is never settleable. */
      settledDays: number;
      leaveTypeName: string | null;
    };
    lateSevere: {
      days: number;
      perDay: string;
      money: string;
      settledDays: number;
      leaveTypeName: string | null;
    };
    earlyLeave: { count: number; perUnit: string; money: string };
  };
};

export type PayrollRowDetail = {
  employeeId: string;
  month: string;
  incomeBase: string;
  incomeAllowance: string;
  incomeOther: string;
  adjustments: { reason: string; kind: 'Income' | 'Deduction'; amount: string }[];
  deductSso: string;
  advances: { amount: string }[];
  debts: { amount: string }[];
  leaveDeductions: { deduct: string; overMinutes: number }[];
  deductAttendance: string;
  deductLeave: string;
  netPay: string;
  breakdown: SerializedBreakdown;
};

// Structural param avoids importing decimal.js's Decimal type into run.ts —
// both Prisma.Decimal and decimal.js Decimal satisfy { toString(): string }.
const money = (d: { toString(): string }) => new Prisma.Decimal(d.toString()).toFixed(2);

export type PayrollRowDetailRaw = {
  buckets: {
    incomeBase: number;
    incomeAllowance: number;
    incomeOther: number;
    deductSso: number;
    deductAdvance: number;
    deductAttendance: number;
    deductLeave: number;
    deductDebt: number;
    deductOther: number;
    netPay: number;
  };
  incomeAdjustments: { id: string; reason: string; amount: number }[];
  deductAdjustments: { id: string; reason: string; amount: number }[];
  advanceCount: number;
  attendance: { absent: number; late: number };
  /** Days of each penalty kind settled with leave this month (Task 3's calc output) — for the payslip's settled-with-leave note. */
  settledDays: SettlementDays;
  /** Which leave type absorbed each settled kind (name + nameByLocale, from this month's settlements) — for the same note. */
  settledLeaveTypeNames: Partial<Record<PenaltyKindKey, { name: string; nameByLocale: unknown }>>;
  leaveOverMinutesTotal: number;
  employee: {
    salaryType: 'Monthly' | 'Daily' | 'Hourly';
    baseSalary: number;
    allowanceLabel: string | null;
  };
  config: { ssoRate: number; ssoSalaryCap: number; workingDaysPerMonth: number };
};

export async function payrollRowDetailRaw(
  month: string,
  employeeId: string,
): Promise<PayrollRowDetailRaw | null> {
  const { drafts } = await gatherAndCalc(prisma, month, employeeId);
  const entry = drafts[0];
  if (!entry) return null;
  const { draft } = entry;
  const b = draft.breakdown;

  const [config, employee, adjustments] = await Promise.all([
    prisma.payrollConfig.findFirstOrThrow({
      select: { ssoRate: true, ssoSalaryCap: true, workingDaysPerMonth: true },
    }),
    prisma.employee.findUniqueOrThrow({
      where: { id: employeeId },
      select: { salaryType: true, baseSalary: true, allowanceLabel: true },
    }),
    prisma.payrollAdjustment.findMany({
      where: {
        employeeId,
        startMonth: { lte: month },
        OR: [{ endMonth: null }, { endMonth: { gte: month } }],
        deletedAt: null,
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        kind: true,
        reason: true,
        amount: true,
        startMonth: true,
        endMonth: true,
      },
    }),
  ]);

  const applicable = adjustments.filter((a) => adjustmentAppliesToMonth(a, month));
  const mapAdj = (kind: 'Income' | 'Deduction') =>
    applicable
      .filter((a) => a.kind === kind)
      .map((a) => ({ id: a.id, reason: a.reason, amount: a.amount.toNumber() }));

  return {
    buckets: {
      incomeBase: draft.incomeBase.toNumber(),
      incomeAllowance: draft.incomeAllowance.toNumber(),
      incomeOther: draft.incomeOther.toNumber(),
      deductSso: draft.deductSso.toNumber(),
      deductAdvance: draft.deductAdvance.toNumber(),
      deductAttendance: draft.deductAttendance.toNumber(),
      deductLeave: draft.deductLeave.toNumber(),
      deductDebt: draft.deductDebt.toNumber(),
      deductOther: draft.deductOther.toNumber(),
      netPay: draft.netPay.toNumber(),
    },
    incomeAdjustments: mapAdj('Income'),
    deductAdjustments: mapAdj('Deduction'),
    advanceCount: entry.sweptAdvanceIds.length,
    attendance: { absent: b.absentCount, late: b.lateCount },
    settledDays: b.attendance.settledDays,
    settledLeaveTypeNames: entry.settlement?.leaveTypeNames ?? {},
    leaveOverMinutesTotal: entry.sweptLeaves.reduce((s, l) => s + l.over, 0),
    employee: {
      salaryType: employee.salaryType as 'Monthly' | 'Daily' | 'Hourly',
      baseSalary: employee.baseSalary.toNumber(),
      allowanceLabel: employee.allowanceLabel,
    },
    config: {
      ssoRate: config.ssoRate.toNumber(),
      ssoSalaryCap: config.ssoSalaryCap.toNumber(),
      workingDaysPerMonth: config.workingDaysPerMonth,
    },
  };
}

export async function payrollRowDetail(
  month: string,
  employeeId: string,
): Promise<PayrollRowDetail | null> {
  const { drafts } = await gatherAndCalc(prisma, month, employeeId);
  const entry = drafts[0];
  if (!entry) return null;
  const { draft } = entry;
  const b = draft.breakdown;

  // Source-row line lists (the calc engine only sees amounts; reasons/ids live here).
  const adjustments = (
    await prisma.payrollAdjustment.findMany({
      where: {
        employeeId,
        startMonth: { lte: month },
        OR: [{ endMonth: null }, { endMonth: { gte: month } }],
        deletedAt: null,
      },
      orderBy: { createdAt: 'asc' },
      select: { kind: true, reason: true, amount: true, startMonth: true, endMonth: true },
    })
  )
    // Mirrors gatherAndCalc's in-memory gate: SQL is a coarse month-window
    // pre-filter; adjustmentAppliesToMonth is the authoritative rule.
    .filter((a) => adjustmentAppliesToMonth(a, month))
    .map((a) => ({
      reason: a.reason,
      kind: a.kind as 'Income' | 'Deduction',
      amount: money(a.amount),
    }));

  return {
    employeeId,
    month,
    incomeBase: money(draft.incomeBase),
    incomeAllowance: money(draft.incomeAllowance),
    incomeOther: money(draft.incomeOther),
    adjustments,
    deductSso: money(draft.deductSso),
    advances: (entry.sweptAdvanceIds.length
      ? await prisma.cashAdvance.findMany({
          where: { id: { in: entry.sweptAdvanceIds } },
          select: { amount: true },
        })
      : []
    ).map((a) => ({ amount: money(a.amount) })),
    debts: (entry.appliedRecurring.length
      ? await prisma.recurringDeduction.findMany({
          where: { id: { in: entry.appliedRecurring.map((r) => r.id) } },
          select: { monthlyAmount: true },
        })
      : []
    ).map((r) => ({ amount: money(r.monthlyAmount) })),
    leaveDeductions: entry.sweptLeaves.map((l) => ({
      deduct: money(l.deduct),
      overMinutes: l.over,
    })),
    deductAttendance: money(draft.deductAttendance),
    deductLeave: money(draft.deductLeave),
    netPay: money(draft.netPay),
    breakdown: {
      sso: {
        cappedBase: money(b.sso.cappedBase),
        rate: b.sso.rate.toString(),
        rawAmount: money(b.sso.rawAmount),
        amountCap: money(b.sso.amountCap),
        applied: money(b.sso.applied),
        capped: b.sso.rawAmount.greaterThan(b.sso.amountCap),
      },
      attendance: {
        absent: {
          count: b.attendance.absent.count,
          perDay: money(b.attendance.absent.perDay),
          money: money(b.attendance.absent.money),
          settledDays: b.attendance.settledDays.Absent,
          leaveTypeName: entry.settlement?.leaveTypeNames.Absent?.name ?? null,
        },
        lateTier1: {
          mode: b.attendance.lateTier1.mode,
          count: b.attendance.lateTier1.count,
          threeStrikeCount: b.attendance.lateTier1.threeStrikeCount,
          days: b.attendance.lateTier1.days,
          perUnit: money(b.attendance.lateTier1.perUnit),
          money: money(b.attendance.lateTier1.money),
          // A flat-mode late is never settleable (calc.ts never nets it against
          // LateThreeStrike days) — zeroed here so the pane can't show a
          // settlement note for a kind that didn't actually reduce the charge.
          settledDays:
            b.attendance.lateTier1.mode === 'threeStrike'
              ? b.attendance.settledDays.LateThreeStrike
              : 0,
          leaveTypeName:
            b.attendance.lateTier1.mode === 'threeStrike'
              ? (entry.settlement?.leaveTypeNames.LateThreeStrike?.name ?? null)
              : null,
        },
        lateSevere: {
          days: b.attendance.lateSevere.days,
          perDay: money(b.attendance.lateSevere.perDay),
          money: money(b.attendance.lateSevere.money),
          settledDays: b.attendance.settledDays.SevereLate,
          leaveTypeName: entry.settlement?.leaveTypeNames.SevereLate?.name ?? null,
        },
        earlyLeave: {
          count: b.attendance.earlyLeave.count,
          perUnit: money(b.attendance.earlyLeave.perUnit),
          money: money(b.attendance.earlyLeave.money),
        },
      },
    },
  };
}
