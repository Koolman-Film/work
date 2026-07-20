'use server';

/**
 * Server actions for the reconcile page's penalty-settlement section
 * (Task 9). Deliberately NOT part of penalty-settlement-admin.ts — that
 * module stays the ONLY writer of AttendancePenaltySettlement, with its own
 * permission/period/balance guards. This file adds nothing to that table; it
 * only wraps those calls with the same "recalculate the month's Drafts, then
 * revalidate" follow-up that the sibling /admin/payroll actions use for
 * every other write that can move the money column (see createRowAdjustment
 * / deleteRowAdjustment in ../actions.ts) — without it, a settlement would
 * save but the persisted Payroll.deductAttendance the page displays would
 * stay stale until someone re-ran "คำนวณ" from the main payroll page.
 */

import { revalidatePath } from 'next/cache';
import type { PenaltyKindKey } from '@/lib/payroll/penalty-settlement';
import {
  clearPenaltySettlement,
  setPenaltySettlement,
} from '@/lib/payroll/penalty-settlement-admin';
import { runPayrollDraft } from '@/lib/payroll/run';

type Result = { ok: true } | { ok: false; error: string };

export async function setReconcileSettlement(input: {
  employeeId: string;
  month: string;
  kind: PenaltyKindKey;
  leaveTypeId: string;
  days: number;
}): Promise<Result> {
  const result = await setPenaltySettlement(input);
  if (result.ok) {
    await runPayrollDraft(input.month);
    revalidatePath('/admin/payroll/reconcile');
    revalidatePath('/admin/payroll');
  }
  return result;
}

export async function clearReconcileSettlement(input: {
  employeeId: string;
  month: string;
  kind: PenaltyKindKey;
}): Promise<Result> {
  const result = await clearPenaltySettlement(input);
  if (result.ok) {
    await runPayrollDraft(input.month);
    revalidatePath('/admin/payroll/reconcile');
    revalidatePath('/admin/payroll');
  }
  return result;
}
