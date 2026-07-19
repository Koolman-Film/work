/**
 * How much of an attendance penalty is still owed in money after the part the
 * admin chose to settle with leave entitlement.
 *
 * Pure and DB-free on purpose: the payroll calculation must be able to run any
 * number of times without side effects, so the settlement reaches it as data.
 */

export type PenaltyKindKey = 'Absent' | 'LateThreeStrike' | 'SevereLate';

/** Days of each penalty kind settled with leave, for one employee in one month. */
export type SettlementDays = Record<PenaltyKindKey, number>;

/** No settlement at all — the pre-feature behaviour, and the default. */
export const EMPTY_SETTLEMENT: SettlementDays = {
  Absent: 0,
  LateThreeStrike: 0,
  SevereLate: 0,
};

/**
 * Days still charged as money.
 *
 * Clamped at zero because a settlement can outlive the penalty that justified
 * it: an admin settles an absence with leave, then voids the attendance row.
 * The subtraction alone would go negative, and callers multiply this by the
 * employee's daily rate — so a deleted absence would quietly become a bonus.
 * Callers surface the leftover settlement to the admin separately; this
 * function's job is to make sure the arithmetic can never pay anyone.
 */
export function moneyDaysFor(actualDays: number, settledDays: number): number {
  return Math.max(0, actualDays - settledDays);
}
