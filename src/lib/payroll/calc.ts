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

import { dailyRateFor } from './day-rate';
import { EMPTY_SETTLEMENT, moneyDaysFor, type SettlementDays } from './penalty-settlement';

// ─── Input shapes ────────────────────────────────────────────────────────
// Plain DTOs — NOT Prisma types. Callers translate at the boundary.

export type SalaryType = 'Monthly' | 'Daily' | 'Hourly';

/**
 * Salary types payroll can currently charge an attendance penalty in money
 * for — V1 scope is Monthly only (see the module doc-comment). Exported so
 * callers that must refuse BEFORE ever reaching `calcPayroll` — namely
 * `setPenaltySettlement` (penalty-settlement-admin.ts), which must not let an
 * admin spend an employee's leave entitlement forgiving a money penalty that
 * payroll would never have charged in the first place — derive the SAME
 * condition `calcPayroll` enforces below, instead of hardcoding a second copy
 * of the list that could silently drift from it (e.g. if Daily support is
 * added here later, forgetting to update a duplicate elsewhere).
 */
export function isPayrollChargeableSalaryType(salaryType: SalaryType): boolean {
  return salaryType === 'Monthly';
}

export type EmployeeForPayroll = {
  id: string;
  salaryType: SalaryType;
  /** Base salary as a string or Decimal — any decimal.js-parseable form. */
  baseSalary: string | number | Decimal;
  /**
   * Social security (ประกันสังคม) enrollment. When false, deductSso is 0.
   * Required — callers pass Employee.hasSso explicitly so the pure calc
   * never guesses an enrollment default.
   */
  hasSso: boolean;
  /**
   * Nameable recurring allowance (Employee.allowanceAmount) — "เงินประจำตำแหน่ง"
   * and anything like it. Paid as its own income line.
   *
   * REQUIRED, not optional-with-default, for the same reason as `hasSso`: this
   * is money owed to the employee, and an optional field lets a call site be
   * missed. A missed call site here silently UNDERPAYS — the failure mode
   * nobody notices until an employee reads their slip.
   *
   * Deliberately NOT fed to calcSsoParts or dailyRateFor (§A0.1). Both are
   * charged AGAINST the employee; raising them because someone holds an
   * allowance is not what was asked for.
   */
  allowanceAmount: string | number | Decimal;
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
  /**
   * Late-penalty policy (C9). Optional — when omitted, lateness falls back to
   * the legacy flat `lateDeduction` per Late row (so existing callers/tests are
   * unchanged). The real caller (run.ts) always passes the DB values.
   */
  lateThreeStrikeEnabled?: boolean;
  lateThreeStrikeCount?: number;
  severeLateEnabled?: boolean;
  severeLateThresholdMin?: number;
  /**
   * `PayrollConfig.workingDaysPerMonth` — the divisor `dailyRateFor` uses for
   * Monthly employees. Optional so existing fixtures/callers that predate
   * this field keep compiling; `dailyRateFor` falls back to 30 when omitted
   * (or when the value is zero/negative). This is the SAME number
   * leave-over-quota and OT already divide by — threading it through here is
   * what keeps an absence-day and a leave-day priced identically on one
   * payslip instead of silently disagreeing whenever an admin changes it
   * away from the default.
   */
  workingDaysPerMonth?: number;
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
   * YYYY-MM-DD dates in the pay period where the employee had an approved leave
   * (any unit). A severe late on one of these days is exempt from its 1-day
   * penalty (the leave deduction already covers that day). Omit → none.
   */
  leaveDates?: readonly string[];
  /**
   * Days of each penalty kind the admin chose to settle with leave instead of
   * money. Omit → nothing settled, which is the pre-feature behaviour and the
   * state of almost every employee. Optional deliberately: "absent" here is the
   * normal case with a correct default, unlike remainingMinutes' penalty
   * argument, where a forgotten value would silently overstate a balance.
   */
  penaltySettlement?: SettlementDays;
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
  sso: {
    cappedBase: Decimal;
    rate: Decimal;
    rawAmount: Decimal;
    amountCap: Decimal;
    applied: Decimal;
  };
  attendance: {
    absent: { count: number; perDay: Decimal; money: Decimal };
    lateTier1: {
      mode: 'threeStrike' | 'flat';
      count: number;
      threeStrikeCount?: number;
      days?: number;
      perUnit: Decimal;
      money: Decimal;
    };
    lateSevere: { days: number; perDay: Decimal; money: Decimal };
    earlyLeave: { count: number; perUnit: Decimal; money: Decimal };
    /** Days of each kind paid with leave rather than money. */
    settledDays: SettlementDays;
  };
};

export type PayrollDraft = {
  month: string;
  employeeId: string;

  incomeBase: Decimal;
  /** The allowance, kept out of incomeOther so the payslip can name it. */
  incomeAllowance: Decimal;
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

/** YYYY-MM-DD from a Date (UTC) or an already-formatted string. */
function ymd(d: Date | string): string {
  return typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
}

// ─── Late-penalty policy (C9) ─────────────────────────────────────────────

export type LatePolicyConfig = {
  /** "N lates in the period = 1 day" rule on/off. Off → tier-1 lates fall back
   *  to the flat per-late charge (lateDeduction). */
  threeStrikeEnabled: boolean;
  /** N — how many tier-1 lates equal one 1-day penalty. */
  threeStrikeCount: number;
  /** "severe late on a no-leave day = 1 day" rule on/off. Off → a severe late
   *  is treated as an ordinary (tier-1) late. */
  severeEnabled: boolean;
  /** Minutes past start above which a late is "severe". */
  severeThresholdMin: number;
};

export type LatePenaltyResult = {
  /** Ordinary (non-severe) late count. */
  tier1Count: number;
  /** Severe late count (total, regardless of leave). */
  severeCount: number;
  /** 1-day penalties from the N-lates rule (0 when disabled). */
  threeStrikeDays: number;
  /** 1-day penalties from severe-without-leave (0 when disabled). */
  severeDays: number;
};

/**
 * Pure late-penalty tally for one employee over one pay period. `lates` are the
 * employee's Late rows ({date, minutesLate}); `leaveDates` is the set of period
 * dates with an approved leave (any unit). A late on one of those dates is not
 * chargeable — it counts toward neither the severe penalty nor the N-lates
 * three-strike, because the leave deduction already covers that day.
 *
 * `tier1Count` still reports EVERY ordinary late, chargeable or not: the payslip
 * breakdown shows what happened, while the penalty reflects only what may be
 * charged for.
 */
export function computeLatePenalty(
  lates: ReadonlyArray<{ date: string; minutesLate: number }>,
  leaveDates: ReadonlySet<string>,
  cfg: LatePolicyConfig,
): LatePenaltyResult {
  let tier1 = 0;
  let tier1NoLeave = 0;
  let severe = 0;
  let severeNoLeave = 0;
  for (const l of lates) {
    const isSevere = cfg.severeEnabled && l.minutesLate > cfg.severeThresholdMin;
    if (isSevere) {
      severe++;
      if (!leaveDates.has(l.date)) severeNoLeave++;
    } else {
      tier1++;
      // A late on a day with approved leave is not chargeable: the leave
      // deduction already covers that day. Mirrors severeNoLeave above.
      if (!leaveDates.has(l.date)) tier1NoLeave++;
    }
  }
  const threeStrikeDays =
    cfg.threeStrikeEnabled && cfg.threeStrikeCount > 0
      ? Math.floor(tier1NoLeave / cfg.threeStrikeCount)
      : 0;
  return {
    tier1Count: tier1,
    severeCount: severe,
    threeStrikeDays,
    severeDays: cfg.severeEnabled ? severeNoLeave : 0,
  };
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
export function calcSsoParts(
  baseSalary: Decimal,
  config: Pick<ConfigForPayroll, 'ssoRate' | 'ssoSalaryCap' | 'ssoAmountCap'>,
): {
  cappedBase: Decimal;
  rate: Decimal;
  rawAmount: Decimal;
  amountCap: Decimal;
  applied: Decimal;
} {
  const cappedBase = Decimal.min(baseSalary, toDec(config.ssoSalaryCap));
  const rate = toDec(config.ssoRate);
  const rawAmount = cappedBase.times(rate);
  const amountCap = toDec(config.ssoAmountCap);
  const applied = Decimal.min(rawAmount, amountCap).toDecimalPlaces(2);
  return { cappedBase, rate, rawAmount, amountCap, applied };
}

export function calcSso(
  baseSalary: Decimal,
  config: Pick<ConfigForPayroll, 'ssoRate' | 'ssoSalaryCap' | 'ssoAmountCap'>,
): Decimal {
  return calcSsoParts(baseSalary, config).applied;
}

// ─── Public entry point ──────────────────────────────────────────────────

export function calcPayroll(input: CalcInput): PayrollDraft {
  if (!isPayrollChargeableSalaryType(input.employee.salaryType)) {
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
  const incomeAllowance = toDec(input.employee.allowanceAmount).toDecimalPlaces(2);
  const adjustments = input.adjustments ?? [];
  const incomeOther = sumDec(
    adjustments.filter((a) => a.kind === 'Income').map((a) => ({ value: a.amount })),
  ).toDecimalPlaces(2);

  // Deduction-kind adjustments (เงินลด) get their own bucket.
  const deductOther = sumDec(
    adjustments.filter((a) => a.kind === 'Deduction').map((a) => ({ value: a.amount })),
  ).toDecimalPlaces(2);

  // SSO deduction — compute parts once, use `.applied` as the bucket.
  const ssoParts = input.employee.hasSso
    ? calcSsoParts(baseSalary, input.config)
    : {
        cappedBase: new Decimal(0),
        rate: toDec(input.config.ssoRate),
        rawAmount: new Decimal(0),
        amountCap: toDec(input.config.ssoAmountCap),
        applied: new Decimal(0),
      };
  const deductSso = ssoParts.applied;

  // Cash advances → straight sum.
  const deductAdvance = sumDec(input.advances.map((a) => ({ value: a.amount }))).toDecimalPlaces(2);

  // Recurring deductions → straight sum.
  const deductDebt = sumDec(
    input.recurringDeductions.map((d) => ({ value: d.monthlyAmount })),
  ).toDecimalPlaces(2);

  // Attendance deductions. Absent/EarlyLeave are flat per-row; lateness uses
  // the configurable late-penalty policy (C9).
  let absentCount = 0;
  let earlyLeaveCount = 0;
  const lateRows: Array<{ date: string; minutesLate: number }> = [];
  for (const att of input.attendances) {
    if (att.type === 'Absent') absentCount++;
    else if (att.type === 'EarlyLeave') earlyLeaveCount++;
    else if (att.type === 'Late')
      lateRows.push({ date: ymd(att.date), minutesLate: att.durationMinutes ?? 0 });
  }
  const lateCount = lateRows.length;

  const cfg = input.config;
  const latePolicy: LatePolicyConfig = {
    threeStrikeEnabled: cfg.lateThreeStrikeEnabled ?? false,
    threeStrikeCount: cfg.lateThreeStrikeCount ?? 3,
    severeEnabled: cfg.severeLateEnabled ?? false,
    severeThresholdMin: cfg.severeLateThresholdMin ?? 30,
  };
  const latePenalty = computeLatePenalty(lateRows, new Set(input.leaveDates ?? []), latePolicy);
  // One "day" is a day of THIS employee's pay, not a company-wide flat rate.
  // The customer writes penalties as "หักเงินหรือสิทธิ 1 วัน"; the old flat
  // ฿500 over-charged 32 of 46 people on production. Feeds absences, the
  // N-strikes penalty, severe lateness, AND the slip breakdown — one place.
  const dayAmount = dailyRateFor(
    input.employee,
    cfg.absentDeductionPerDay,
    cfg.workingDaysPerMonth,
  );
  const settled = input.penaltySettlement ?? EMPTY_SETTLEMENT;
  const absentMoneyDays = moneyDaysFor(absentCount, settled.Absent);
  const strikeMoneyDays = moneyDaysFor(latePenalty.threeStrikeDays, settled.LateThreeStrike);
  const severeMoneyDays = moneyDaysFor(latePenalty.severeDays, settled.SevereLate);

  // Tier-1 lates: the N-strikes rule charges a 1-day amount per completed group;
  // when the rule is off, fall back to the legacy flat per-late charge. The flat
  // charge is per occurrence, not a "1 day" unit, so it is never settleable.
  const tier1LateMoney = latePolicy.threeStrikeEnabled
    ? new Decimal(strikeMoneyDays).times(dayAmount)
    : new Decimal(latePenalty.tier1Count).times(toDec(cfg.lateDeduction));
  const severeLateMoney = new Decimal(severeMoneyDays).times(dayAmount);
  const earlyLeaveMoney = toDec(cfg.earlyLeaveDeduction).times(earlyLeaveCount);

  const deductAttendance = dayAmount
    .times(absentMoneyDays)
    .plus(tier1LateMoney)
    .plus(severeLateMoney)
    .plus(earlyLeaveMoney)
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
    .plus(incomeAllowance)
    .plus(incomeOther)
    .minus(deductSso)
    .minus(deductAdvance)
    .minus(deductAttendance)
    .minus(deductDebt)
    .minus(deductLeave)
    .minus(deductOther)
    .toDecimalPlaces(2);

  const breakdown: CalcBreakdown = {
    absentCount,
    lateCount,
    earlyLeaveCount,
    sso: ssoParts,
    attendance: {
      absent: {
        count: absentCount,
        perDay: dayAmount,
        money: dayAmount.times(absentMoneyDays).toDecimalPlaces(2),
      },
      lateTier1: latePolicy.threeStrikeEnabled
        ? {
            mode: 'threeStrike',
            count: latePenalty.tier1Count,
            threeStrikeCount: latePolicy.threeStrikeCount,
            days: latePenalty.threeStrikeDays,
            perUnit: dayAmount,
            money: tier1LateMoney.toDecimalPlaces(2),
          }
        : {
            mode: 'flat',
            count: latePenalty.tier1Count,
            perUnit: toDec(cfg.lateDeduction),
            money: tier1LateMoney.toDecimalPlaces(2),
          },
      lateSevere: {
        days: latePenalty.severeDays,
        perDay: dayAmount,
        money: severeLateMoney.toDecimalPlaces(2),
      },
      earlyLeave: {
        count: earlyLeaveCount,
        perUnit: toDec(cfg.earlyLeaveDeduction),
        money: earlyLeaveMoney.toDecimalPlaces(2),
      },
      // Copy, not alias: `settled` defaults to the module-level EMPTY_SETTLEMENT
      // singleton (see below) — handing that object out by reference would let
      // any future in-place mutation of one employee's breakdown corrupt every
      // other employee (and every later run) sharing the same singleton.
      settledDays: { ...settled },
    },
  };

  return {
    month: input.month,
    employeeId: input.employee.id,
    incomeBase: incomeBase.toDecimalPlaces(2),
    incomeAllowance,
    incomeOther,
    deductSso,
    deductAdvance,
    deductAttendance,
    deductDebt,
    deductLeave,
    deductOther,
    netPay,
    breakdown,
  };
}
