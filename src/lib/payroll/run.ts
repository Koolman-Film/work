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
import { prisma } from '@/lib/db/prisma';
import { sendNotification } from '@/lib/inngest/events';
import { computeLiveLeaveCharges } from '@/lib/leave/recompute';
import { invalidatePayslipPdf } from '@/lib/payslip/storage';
import { adjustmentAppliesToMonth } from './adjustments';
import {
  type AdjustmentForPayroll,
  type AttendanceForPayroll,
  calcPayroll,
  PayrollCalcError,
  type PayrollDraft,
} from './calc';
import { payrollMonthWindow } from './period';

export type SkippedEmployee = {
  employeeId: string;
  name: string;
  reason: string;
};

export type RunResult = {
  calculated: number;
  /** Rows left untouched because they are already Published/Locked. */
  frozen: number;
  skipped: SkippedEmployee[];
};

/** Prisma transaction client — what `$transaction(async (tx) => ...)` passes. */
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Gather every input the calc needs for all non-archived Monthly-paid
 * employees, compute drafts, and report which sweep rows fed each one.
 * Pure read — callers decide what to persist (draft upsert vs publish).
 */
async function gatherAndCalc(db: Tx | typeof prisma, month: string) {
  const config = await db.payrollConfig.findFirst();
  if (!config) throw new Error('PayrollConfig missing — run the seed first.');

  // Payroll period = the cutoff window ending on this month's cutoff day
  // (PDF C8). `end` is inclusive of the cutoff day — queries use lte.
  const { start, end } = payrollMonthWindow(month, config.cutoffDay);

  const employees = await db.employee.findMany({
    where: { status: { not: 'Archived' } },
    select: {
      id: true,
      userId: true,
      firstName: true,
      lastName: true,
      salaryType: true,
      baseSalary: true,
      hasSso: true,
    },
  });
  const empIds = employees.map((e) => e.id);

  const [attendances, advances, recurring, leaveRanges, adjustments] = await Promise.all([
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
      select: { id: true, employeeId: true, amount: true },
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

  const attByEmp = byEmp(attendances);
  const advByEmp = byEmp(advances);
  const recByEmp = byEmp(recurring);
  const adjByEmp = byEmp(adjustments);

  // Leave deductions are derived LIVE from the current entitlement (frozen only
  // at publish), so editing an entitlement is reflected on the next draft with
  // NO manual recompute. Sweep un-paid DeductPay leave whose live over-quota
  // deduction is > 0 and whose startDate is on/before the period cutoff (`end`).
  const liveSweepableByEmp = new Map<string, Array<{ id: string; deduct: number; over: number }>>();
  for (const c of await computeLiveLeaveCharges(empIds)) {
    if (c.swept) continue; // already paid in a published payroll — never re-sweep
    if (c.startDate.getTime() > end.getTime()) continue;
    if (c.deductAmount == null || c.deductAmount <= 0) continue;
    const list = liveSweepableByEmp.get(c.employeeId) ?? [];
    list.push({ id: c.leaveRequestId, deduct: c.deductAmount, over: c.overQuotaMinutes });
    liveSweepableByEmp.set(c.employeeId, list);
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

  const drafts: Array<{
    draft: PayrollDraft;
    employee: (typeof employees)[number];
    sweptAdvanceIds: string[];
    sweptLeaves: Array<{ id: string; deduct: number; over: number }>;
    appliedRecurring: Array<{ id: string; monthsRemaining: number }>;
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

/** Serialize a PayrollDraft's Decimals into Prisma write values. */
function draftValues(draft: PayrollDraft) {
  return {
    incomeBase: new Prisma.Decimal(draft.incomeBase.toFixed(2)),
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
 */
export async function runPayrollDraft(month: string): Promise<RunResult> {
  const { drafts, skipped } = await gatherAndCalc(prisma, month);

  const existing = await prisma.payroll.findMany({
    where: { month },
    select: { id: true, employeeId: true, status: true },
  });
  const existingByEmp = new Map(existing.map((p) => [p.employeeId, p]));

  let calculated = 0;
  let frozen = 0;

  for (const { draft, employee } of drafts) {
    const row = existingByEmp.get(employee.id);
    if (row && row.status !== 'Draft') {
      frozen++;
      continue;
    }
    await prisma.payroll.upsert({
      where: { employeeId_month: { employeeId: employee.id, month } },
      create: { employeeId: employee.id, month, status: 'Draft', ...draftValues(draft) },
      update: { status: 'Draft', ...draftValues(draft) },
    });
    calculated++;
  }

  return { calculated, frozen, skipped };
}

export type PublishedSlip = {
  payrollId: string;
  employeeId: string;
  recipientUserId: string;
  employeeFirstName: string;
  /** "12,500.00" — pre-formatted for the LINE Flex payload. */
  netPay: string;
};

export type PublishResult = {
  published: PublishedSlip[];
  skipped: SkippedEmployee[];
};

/**
 * Publish the month: recalculate inside one transaction, persist as
 * Published, stamp swept rows, decrement recurring deductions. Employees
 * whose row is already Published/Locked are silently left as-is (their
 * stamps were made when they were first published).
 *
 * Caller is responsible for firing notifications from the returned slips
 * (see `notifyPublishedSlips`) and writing the audit log.
 */
export async function publishPayroll(month: string): Promise<PublishResult> {
  const result = await prisma.$transaction(async (tx) => {
    const { drafts, skipped } = await gatherAndCalc(tx, month);

    const existing = await tx.payroll.findMany({
      where: { month },
      select: { id: true, employeeId: true, status: true },
    });
    const existingByEmp = new Map(existing.map((p) => [p.employeeId, p]));

    const published: PublishedSlip[] = [];

    for (const { draft, employee, sweptAdvanceIds, sweptLeaves, appliedRecurring } of drafts) {
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
        await tx.leaveRequest.updateMany({
          where: { id: l.id, deductedInPayrollId: null },
          data: {
            deductedInPayrollId: saved.id,
            deductAmount: new Prisma.Decimal(l.deduct.toFixed(2)),
            overQuotaMinutes: l.over,
          },
        });
      }
      for (const rec of appliedRecurring) {
        const remaining = rec.monthsRemaining - 1;
        await tx.recurringDeduction.update({
          where: { id: rec.id },
          data: { monthsRemaining: remaining, ...(remaining <= 0 ? { endedAt: new Date() } : {}) },
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

    return { published, skipped };
  });

  // Bust any cached PDF for freshly-published slips so a download reflects the
  // finalized numbers. Fire-and-forget: a Storage hiccup must never fail publish.
  for (const slip of result.published) {
    void invalidatePayslipPdf(slip.employeeId, month).catch(() => {});
  }

  return result;
}

/** Fire the per-employee LINE push for freshly published slips. */
export async function notifyPublishedSlips(month: string, slips: PublishedSlip[]): Promise<void> {
  await Promise.all(
    slips.map((s) =>
      sendNotification(s.recipientUserId, {
        kind: 'payroll.published',
        payrollId: s.payrollId,
        month,
        employeeFirstName: s.employeeFirstName,
        netPay: s.netPay,
      }),
    ),
  );
}

/** Flip every Published row of the month to Locked. Returns count. */
export async function lockPayroll(month: string): Promise<number> {
  const res = await prisma.payroll.updateMany({
    where: { month, status: 'Published' },
    data: { status: 'Locked' },
  });
  return res.count;
}
