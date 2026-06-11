/**
 * Pure payroll calculation — Phase 2 W6.
 *
 * The single source of truth for "given an employee's month, what does
 * their pay slip look like." Deliberately:
 *
 *   - **Pure** — no DB, no I/O, no time-of-day dependence. The caller
 *     fetches all inputs and passes them in. Same inputs → same output,
 *     forever.
 *   - **Decimal-based** — uses `decimal.js` throughout to avoid IEEE-754
 *     drift on money. Inputs accept strings or Decimals; outputs are
 *     always Decimals so the caller decides how to serialize.
 *   - **Single-pass** — walks attendance + advances + recurring
 *     deductions once; sums into the relevant buckets; computes net at
 *     the end. No re-fetching or recursive logic.
 *
 * Why a pure function rather than a service-method-on-class:
 *   - Trivial to unit-test with fixture data (the W6 spec calls for 15
 *     fixture cases — see calc.test.ts for the first batch).
 *   - The Inngest fan-out (W7) can call this on each employee in
 *     parallel; each call is hermetic so retries are idempotent.
 *   - When the shadow-run UAT (W9) finds a discrepancy with the
 *     customer's Excel, the failure is bisectable — feed in their
 *     numbers, compare outputs.
 *
 * V1 scope:
 *   - Monthly salary only. Daily / Hourly throw 'unsupported-salary-type'.
 *   - Attendance deductions are FLAT per-row (configurable on
 *     PayrollConfig). Per-minute precision is a Phase-2 polish.
 *   - No OT calculation yet — `otMultiplier` is in the config for the
 *     future. OT rows aren't even in AttType.
 *   - No proration for mid-month start/end — full month assumed. The
 *     calc-time will let us add a proration helper later without
 *     changing the function signature.
 *   - **Leave deductions (deductLeave):** over-quota leave amounts that
 *     were frozen at leave-approval time (LeaveRequest.deductAmount).
 *     The future payroll pipeline MUST sweep:
 *       SELECT deductAmount FROM LeaveRequest
 *       WHERE status = 'Approved'
 *         AND deletedAt IS NULL
 *         AND deductedInPayrollId IS NULL
 *         AND employeeId = <employeeId>
 *         AND [leave falls within pay-period month]
 *     and pass the results as `leaveDeductions`. In the same DB
 *     transaction that creates the Payroll row, the pipeline must stamp
 *     `deductedInPayrollId` on each swept LeaveRequest — this is the
 *     once-only idempotency contract (re-running the pipeline will find
 *     no un-stamped rows for the same month).
 */

import Decimal from 'decimal.js';

// ─── Input shapes ────────────────────────────────────────────────────────
// Plain DTOs — NOT Prisma types. Callers translate at the boundary.

export type SalaryType = 'Monthly' | 'Daily' | 'Hourly';

export type EmployeeForPayroll = {
  id: string;
  salaryType: SalaryType;
  /** Base salary as a string or Decimal — any decimal.js-parseable form. */
  baseSalary: string | number | Decimal;
  /**
   * Social security (ประกันสังคม) enrollment. When false, deductSso is 0.
   * Optional defaulting to true — matches Employee.hasSso's DB default and
   * keeps pre-feature fixtures valid.
   */
  hasSso?: boolean;
};

/**
 * An admin-entered earning/deduction (PayrollAdjustment) already filtered
 * to this pay-period month by the caller (see adjustments.ts). Income kinds
 * sum into incomeOther; Deduction kinds into deductOther.
 */
export type AdjustmentForPayroll = {
  kind: 'Income' | 'Deduction';
  amount: string | number | Decimal;
};

export type AttendanceForPayroll = {
  /** Calendar date (Date or YYYY-MM-DD). Only the date part matters. */
  date: Date | string;
  type: 'CheckIn' | 'CheckOut' | 'Absent' | 'Late' | 'EarlyLeave' | 'OnLeave';
  durationMinutes?: number | null;
};

export type AdvanceForPayroll = {
  amount: string | number | Decimal;
};

export type RecurringDeductionForPayroll = {
  monthlyAmount: string | number | Decimal;
};

/**
 * A single over-quota leave deduction that was frozen at leave-approval
 * time (LeaveRequest.deductAmount). The pipeline sweeps un-stamped rows
 * and passes them here; see the module doc-comment for the sweep contract.
 */
export type LeaveDeductionForPayroll = {
  amount: string | number | Decimal;
};

export type ConfigForPayroll = {
  ssoRate: string | number | Decimal;
  ssoSalaryCap: string | number | Decimal;
  ssoAmountCap: string | number | Decimal;
  absentDeductionPerDay: string | number | Decimal;
  lateDeduction: string | number | Decimal;
  earlyLeaveDeduction: string | number | Decimal;
};

export type CalcInput = {
  employee: EmployeeForPayroll;
  attendances: readonly AttendanceForPayroll[];
  advances: readonly AdvanceForPayroll[];
  recurringDeductions: readonly RecurringDeductionForPayroll[];
  /**
   * Over-quota leave deductions frozen at approval time. Omit (or pass
   * an empty array) when none apply — `deductLeave` will be 0.
   */
  leaveDeductions?: readonly LeaveDeductionForPayroll[];
  /**
   * Earnings/deductions applicable to this month. Omit for none — both
   * incomeOther and deductOther will be 0.
   */
  adjustments?: readonly AdjustmentForPayroll[];
  config: ConfigForPayroll;
  /** YYYY-MM string of the pay-period month. Currently only used for traceability in the output. */
  month: string;
};

// ─── Output shape ────────────────────────────────────────────────────────

export type CalcBreakdown = {
  /** How many `Absent` attendance rows contributed to deductAttendance. */
  absentCount: number;
  /** How many `Late` attendance rows contributed. */
  lateCount: number;
  /** How many `EarlyLeave` rows contributed. */
  earlyLeaveCount: number;
};

export type PayrollDraft = {
  month: string;
  employeeId: string;

  incomeBase: Decimal;
  incomeOther: Decimal;

  deductSso: Decimal;
  deductAdvance: Decimal;
  deductAttendance: Decimal;
  deductDebt: Decimal;
  /** Sum of over-quota leave deductions for the period. */
  deductLeave: Decimal;
  /** Sum of Deduction-kind adjustments (เงินลด). */
  deductOther: Decimal;

  netPay: Decimal;

  breakdown: CalcBreakdown;
};

export type CalcError =
  | { kind: 'unsupported-salary-type'; given: SalaryType }
  | { kind: 'negative-net'; netPay: Decimal };

/** Thrown when calc cannot produce a valid result. */
export class PayrollCalcError extends Error {
  constructor(public detail: CalcError) {
    super(JSON.stringify(detail));
    this.name = 'PayrollCalcError';
  }
}

// ─── Internal helpers ────────────────────────────────────────────────────

function toDec(v: string | number | Decimal): Decimal {
  return v instanceof Decimal ? v : new Decimal(v);
}

function sumDec(items: readonly { value: string | number | Decimal }[]): Decimal {
  return items.reduce<Decimal>((acc, x) => acc.plus(toDec(x.value)), new Decimal(0));
}

/**
 * SSO (Social Security) per Thai law:
 *   contribution = min(baseSalary × ssoRate, ssoAmountCap)
 *   the baseSalary input is itself capped at ssoSalaryCap before
 *   multiplying. So:
 *     contribution = min(min(baseSalary, ssoSalaryCap) × ssoRate, ssoAmountCap)
 *
 * Both caps are applied because they're independently expressed in law
 * (the 5% rate × 15K cap → 750 baseline), and the `ssoAmountCap` line
 * exists for when the rate or cap is adjusted in the future.
 */
function calcSso(baseSalary: Decimal, config: ConfigForPayroll): Decimal {
  const cappedBase = Decimal.min(baseSalary, toDec(config.ssoSalaryCap));
  const raw = cappedBase.times(toDec(config.ssoRate));
  return Decimal.min(raw, toDec(config.ssoAmountCap)).toDecimalPlaces(2);
}

// ─── Public entry point ──────────────────────────────────────────────────

export function calcPayroll(input: CalcInput): PayrollDraft {
  if (input.employee.salaryType !== 'Monthly') {
    throw new PayrollCalcError({
      kind: 'unsupported-salary-type',
      given: input.employee.salaryType,
    });
  }

  const baseSalary = toDec(input.employee.baseSalary);

  // Income.
  // V1: incomeBase = full month base; no proration. incomeOther = the sum
  // of Income-kind adjustments (เงินเพิ่ม) the caller selected for this month.
  const incomeBase = baseSalary;
  const adjustments = input.adjustments ?? [];
  const incomeOther = sumDec(
    adjustments.filter((a) => a.kind === 'Income').map((a) => ({ value: a.amount })),
  ).toDecimalPlaces(2);

  // Deduction-kind adjustments (เงินลด) get their own bucket.
  const deductOther = sumDec(
    adjustments.filter((a) => a.kind === 'Deduction').map((a) => ({ value: a.amount })),
  ).toDecimalPlaces(2);

  // SSO deduction (capped by Thai law) — only for enrolled employees.
  const deductSso =
    input.employee.hasSso === false ? new Decimal(0) : calcSso(baseSalary, input.config);

  // Cash advances → straight sum.
  const deductAdvance = sumDec(input.advances.map((a) => ({ value: a.amount }))).toDecimalPlaces(2);

  // Recurring deductions → straight sum.
  const deductDebt = sumDec(
    input.recurringDeductions.map((d) => ({ value: d.monthlyAmount })),
  ).toDecimalPlaces(2);

  // Attendance deductions — count Absent / Late / EarlyLeave rows,
  // multiply by their per-event flat rate.
  let absentCount = 0;
  let lateCount = 0;
  let earlyLeaveCount = 0;
  for (const att of input.attendances) {
    if (att.type === 'Absent') absentCount++;
    else if (att.type === 'Late') lateCount++;
    else if (att.type === 'EarlyLeave') earlyLeaveCount++;
  }
  const deductAttendance = toDec(input.config.absentDeductionPerDay)
    .times(absentCount)
    .plus(toDec(input.config.lateDeduction).times(lateCount))
    .plus(toDec(input.config.earlyLeaveDeduction).times(earlyLeaveCount))
    .toDecimalPlaces(2);

  // Leave deductions — over-quota leave amounts frozen at approval time.
  const deductLeave = sumDec(
    (input.leaveDeductions ?? []).map((d) => ({ value: d.amount })),
  ).toDecimalPlaces(2);

  // Net = income - deductions. We allow negative (would mean the
  // employee somehow owes the company more than their salary), but
  // surface it as an error case the caller can choose to handle —
  // typically by capping at zero AND alerting the admin.
  const netPay = incomeBase
    .plus(incomeOther)
    .minus(deductSso)
    .minus(deductAdvance)
    .minus(deductAttendance)
    .minus(deductDebt)
    .minus(deductLeave)
    .minus(deductOther)
    .toDecimalPlaces(2);

  return {
    month: input.month,
    employeeId: input.employee.id,
    incomeBase: incomeBase.toDecimalPlaces(2),
    incomeOther,
    deductSso,
    deductAdvance,
    deductAttendance,
    deductDebt,
    deductLeave,
    deductOther,
    netPay,
    breakdown: { absentCount, lateCount, earlyLeaveCount },
  };
}
