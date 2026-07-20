/**
 * Pure helpers for the payroll reconcile page's penalty-settlement section
 * (Task 9). Kept dependency-free (no Prisma, no React) so the branchy bits —
 * which kinds are worth showing, whether a settlement outlived its penalty —
 * are trivially unit-testable under Vitest's node environment, which cannot
 * render the client component (`reconcile-rows.tsx`) that actually uses them.
 */

import type { CalcBreakdown } from './calc';
import type { PenaltyKindKey, SettlementDays } from './penalty-settlement';

export const PENALTY_KINDS: readonly PenaltyKindKey[] = ['Absent', 'LateThreeStrike', 'SevereLate'];

/**
 * Per-employee data the reconcile page needs to render one employee's
 * settlement section: the live actual penalty days, what's currently settled
 * with leave (+ which leave type, for display), and whether that employee's
 * payroll row for the month is still editable.
 */
export type PenaltyRowInfo = {
  actualDays: SettlementDays;
  settledDays: SettlementDays;
  leaveTypeNames: Partial<Record<PenaltyKindKey, string>>;
  isDraft: boolean;
};

/**
 * How many days of each penalty kind actually happened this month, read off
 * a freshly (re)computed `CalcBreakdown.attendance` — the same live number
 * `calcPayroll` itself charges money against. `lateTier1.days` is only
 * meaningful in 'threeStrike' mode; in 'flat' mode the N-strikes penalty
 * doesn't exist, so LateThreeStrike reads as 0 (which correctly flags any
 * lingering settlement of that kind as over-settled).
 */
export function actualDaysFromAttendance(attendance: CalcBreakdown['attendance']): SettlementDays {
  return {
    Absent: attendance.absent.count,
    LateThreeStrike:
      attendance.lateTier1.mode === 'threeStrike' ? (attendance.lateTier1.days ?? 0) : 0,
    SevereLate: attendance.lateSevere.days,
  };
}

/**
 * Which penalty kinds are worth a line on the reconcile row: it currently
 * has an actual penalty, OR it has a lingering settlement even though the
 * penalty that justified it is gone (actualDays 0) — that stranded case is
 * exactly what an admin needs to see, not hide.
 */
export function kindsToShow(
  actualDays: SettlementDays,
  settledDays: SettlementDays,
): PenaltyKindKey[] {
  return PENALTY_KINDS.filter((k) => actualDays[k] > 0 || settledDays[k] > 0);
}

/**
 * True when more leave was withheld for this kind than the month's actual
 * penalty justifies — the usual cause is the settled attendance row being
 * voided after the leave was already spent. `moneyDaysFor` (penalty-
 * settlement.ts) clamps the money side of this to zero so it can never pay
 * anyone; this is what surfaces the mismatch to a human so the leave itself
 * can be investigated and returned if warranted.
 */
export function isOverSettled(actualDays: number, settledDays: number): boolean {
  return settledDays > actualDays;
}

/** True when ANY of the three kinds is over-settled for this row. */
export function hasAnyOverSettlement(
  actualDays: SettlementDays,
  settledDays: SettlementDays,
): boolean {
  return PENALTY_KINDS.some((k) => isOverSettled(actualDays[k], settledDays[k]));
}
