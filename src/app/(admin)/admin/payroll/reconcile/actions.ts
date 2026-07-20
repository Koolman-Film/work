'use server';

/**
 * Server actions for the reconcile page's penalty-settlement section
 * (Task 9) — also imported by the manual attendance form
 * (admin/attendance/manual/manual-form.tsx, a client component) for the same
 * settle-then-recalculate contract (Defect 3). Deliberately NOT part of
 * penalty-settlement-admin.ts — that module stays the ONLY writer of
 * AttendancePenaltySettlement, with its own permission/period/balance
 * guards. This file adds nothing to that table; it only wraps those calls
 * with the same "recalculate the month's Drafts, then revalidate" follow-up
 * that the sibling /admin/payroll actions use for every other write that can
 * move the money column (see createRowAdjustment / deleteRowAdjustment in
 * ../actions.ts) — without it, a settlement would save but the persisted
 * Payroll.deductAttendance the page displays would stay stale until someone
 * re-ran "คำนวณ" from the main payroll page.
 */

import { revalidatePath } from 'next/cache';
import type { PenaltyKindKey } from '@/lib/payroll/penalty-settlement';
import {
  clearPenaltySettlement,
  setPenaltySettlement,
} from '@/lib/payroll/penalty-settlement-admin';
import { runPayrollDraft } from '@/lib/payroll/run';

/**
 * `recalcPending: true` on a success means: the settlement itself is
 * committed (leave already spent / restored, money offset already applied)
 * — only the courtesy draft recalculation below failed, most likely because
 * this settle just released the month lock that a concurrent publish/
 * recalculate (month-lock.ts) is now contending for. This is NOT a failure
 * of the save — `ok: false` must be reserved for setPenaltySettlement/
 * clearPenaltySettlement themselves refusing the write, since that is the
 * only case where nothing was persisted. Telling the admin "save failed"
 * for a `runPayrollDraft` hiccup after the settlement already committed
 * would be false, and would likely cause them to retry an action that
 * already succeeded (Defect 2).
 */
type Result = { ok: true; recalcPending?: boolean } | { ok: false; error: string };

/**
 * Recalculate the month's Drafts after a settlement commits, without letting
 * a failure here read as the settlement having failed. Shared by every
 * settle path below.
 */
async function recalculateAfterSettlement(month: string): Promise<{ recalcPending?: boolean }> {
  revalidatePath('/admin/payroll/reconcile');
  revalidatePath('/admin/payroll');
  try {
    await runPayrollDraft(month);
    return {};
  } catch (err) {
    console.error(
      'recalculateAfterSettlement: runPayrollDraft failed after a settlement already committed',
      err,
    );
    return { recalcPending: true };
  }
}

type SettleInput = {
  employeeId: string;
  month: string;
  kind: PenaltyKindKey;
  leaveTypeId: string;
  days: number;
};

/** Common core of `setReconcileSettlement` and `setManualAttendanceSettlement`
 *  below — settle, then recalculate + revalidate, with `via` kept distinct
 *  per caller for the audit trail (setPenaltySettlement's `via` discriminates
 *  'reconcile' from 'manual-attendance'; see penalty-settlement-admin.ts). */
async function settleAndRecalc(
  input: SettleInput,
  via: 'manual-attendance' | 'reconcile',
): Promise<Result> {
  const result = await setPenaltySettlement({ ...input, via });
  if (!result.ok) return result;
  const { recalcPending } = await recalculateAfterSettlement(input.month);
  return { ok: true, ...(recalcPending ? { recalcPending } : {}) };
}

export async function setReconcileSettlement(input: SettleInput): Promise<Result> {
  return settleAndRecalc(input, 'reconcile');
}

/**
 * Same settle-then-recalculate-then-revalidate contract as
 * `setReconcileSettlement` above, reused (not reimplemented) for the manual
 * attendance form (Defect 3) — that form used to call
 * `setPenaltySettlement` directly and leave the month's Draft (and
 * therefore /admin/payroll's displayed deductAttendance) stale until an
 * admin happened to press "คำนวณ" again. This is a full recalculation
 * rather than just a revalidate: it is the more correct fix (the exact
 * numbers, not just a staleness flag), and it costs nothing extra here since
 * `runPayrollDraft` already scopes its DB work reasonably and this whole
 * settle flow already tolerates the same failure mode via `recalcPending`.
 */
export async function setManualAttendanceSettlement(input: SettleInput): Promise<Result> {
  return settleAndRecalc(input, 'manual-attendance');
}

export async function clearReconcileSettlement(input: {
  employeeId: string;
  month: string;
  kind: PenaltyKindKey;
}): Promise<Result> {
  const result = await clearPenaltySettlement({ ...input, via: 'reconcile' });
  if (!result.ok) return result;
  const { recalcPending } = await recalculateAfterSettlement(input.month);
  return { ok: true, ...(recalcPending ? { recalcPending } : {}) };
}
