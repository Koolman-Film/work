/**
 * Salary-balance calculation for the LIFF advance UI.
 *
 * What "available to request" means in this codebase:
 *
 *   available = baseSalary − deductions − reserved
 *
 *   deductions = NET-pay reducers that are STABLE and known all month: SSO
 *                (ประกันสังคม) + active recurring deductions (company loans,
 *                installments). Fluctuating ones (attendance/leave/keyed
 *                adjustments) are deliberately excluded so the cap doesn't jump
 *                mid-month; the admin approval is the final gate. (Requirement:
 *                "ไม่ให้เบิกเกินเงินเดือนสุทธิ".) Commission/OT never raise the
 *                cap because it's built from baseSalary, not gross income.
 *
 *   reserved = Σ amount of CashAdvance rows for this employee where
 *              status ∈ {Pending, Approved} AND isDeducted = false
 *
 * Why we count Pending AND Approved-not-yet-deducted (not just one):
 *   - Pending alone misses already-approved advances that haven't hit
 *     the next payroll yet.
 *   - Approved alone lets an employee double-spend by submitting two
 *     concurrent pending requests for the full salary, getting both
 *     approved in sequence, and exceeding their actual entitlement.
 *
 * We do NOT count Rejected/Cancelled (those returned the entitlement
 * back to the pool) or Approved-already-deducted (those already came
 * out of last payroll's net pay; they're not "reserved against the
 * next one anymore" — they're history).
 *
 * Salary-type handling:
 *   - 'Monthly': baseSalary is the monthly cap; available = baseSalary − reserved
 *   - 'Daily' / 'Hourly': baseSalary is the per-period RATE, not a cap.
 *     We can't compute a meaningful "available" without knowing days/hours
 *     worked this period. For V1 we surface the rate + reserved amount
 *     so employees see what they've already committed, but we don't
 *     pretend to know what's left. Phase 2 (payroll automation) will
 *     compute estimated period earnings from attendance × rate.
 */

import { Prisma } from '@prisma/client';

export type SalaryType = 'Monthly' | 'Daily' | 'Hourly';

export type AdvanceBalanceInput = {
  baseSalary: Prisma.Decimal | string | number;
  salaryType: SalaryType;
  /** Nameable recurring allowance (Employee.allowanceAmount) — part of the cap
   *  basis, per the request "เวลาเบิกให้คิดยอดรวมจาก เงินเดือน + เงินประจำตำแหน่ง".
   *
   *  REQUIRED, not optional-with-default: this file is the single cap formula
   *  behind BOTH the LIFF request form and the admin approval guard, and a
   *  missed call site would quietly understate what an employee may draw. */
  allowanceAmount: Prisma.Decimal | string | number;
  /** Baht that must remain undrawn (PayrollConfig.advanceMinRemaining).
   *
   *  Applied as a REDUCTION OF `available`, not as a separate gate, so the
   *  existing isOverCap enforces it on both the LIFF request form and the admin
   *  approval guard for free — and the employee sees an honest number rather
   *  than a rejection after the fact.
   *
   *  REQUIRED, not optional-with-default: an optional floor lets a call site be
   *  missed, and a missed floor silently lets an employee draw past the exact
   *  limit this field exists to enforce. That is the dangerous direction; a
   *  missed allowance only under-permits. 0 = no floor. */
  minRemaining: Prisma.Decimal | string | number;
  /** Advance rows where status ∈ {Pending, Approved} AND isDeducted=false. */
  reservedAdvances: ReadonlyArray<{
    status: 'Pending' | 'Approved';
    amount: Prisma.Decimal | string | number;
  }>;
  /** Earned-so-far this payroll period for Daily/Hourly; when provided the
   *  rate-based variant gains available/overdrawn. */
  periodEarnings?: number | null;
  /** NET standing adjustment to the cap so an advance can't exceed NET pay
   *  (requirement: "ไม่ให้เบิกเกินเงินเดือนสุทธิ"). Positive lowers the cap,
   *  NEGATIVE raises it.
   *
   *  Comprises SSO + active recurring deductions + this month's PayrollAdjustment
   *  rows, where เงินลด (Deduction) adds and เงินเพิ่ม (Income) subtracts.
   *
   *  Leave deductions are still EXCLUDED, deliberately. computeLiveLeaveCharges
   *  has no lower date bound and returns every un-swept over-quota charge from
   *  all time, so feeding it here would give anyone carrying a backlog a
   *  permanently negative balance — see §A0.2 and the ฿27,450 case. Revisit only
   *  once that is bounded. Default 0. */
  monthlyDeductions?: number;
};

export type AdvanceBalance =
  | {
      kind: 'monthly';
      baseSalary: number;
      allowance: number; // added to baseSalary to form the cap basis
      deductions: number; // SSO + recurring subtracted to reach NET cap
      pending: number; // sum of Pending advances
      approvedNotDeducted: number; // sum of Approved-but-not-deducted advances
      reserved: number; // pending + approvedNotDeducted
      available: number; // baseSalary - deductions - reserved; negative if over-approved
      overdrawn: boolean; // true when available < 0
    }
  | {
      kind: 'rate-based'; // Daily / Hourly
      salaryType: 'Daily' | 'Hourly';
      ratePerPeriod: number;
      allowance: number; // monthly, so added on top of earnings rather than scaled
      deductions: number; // SSO + recurring subtracted to reach NET cap
      pending: number;
      approvedNotDeducted: number;
      reserved: number;
      earnings: number | null; // null when periodEarnings not supplied (V1)
      available: number | null; // earnings - deductions - reserved; null when earnings unknown
      overdrawn: boolean; // true when available is known and < 0
    };

/** The over-cap rule shared by the admin UI gate and the server approval
 *  guard — one comparison, two surfaces, no drift. null available (rate-based
 *  with uncomputable earnings) never blocks. */
export function isOverCap(amount: number, available: number | null): boolean {
  return available != null && amount > available;
}

/** Coerce Prisma.Decimal | string | number to a JS number. */
function toNumber(v: Prisma.Decimal | string | number): number {
  if (v instanceof Prisma.Decimal) return v.toNumber();
  if (typeof v === 'string') return Number(v);
  return v;
}

export function calculateAdvanceBalance(input: AdvanceBalanceInput): AdvanceBalance {
  const baseSalary = toNumber(input.baseSalary);
  const allowance = Math.max(0, toNumber(input.allowanceAmount) || 0);

  let pending = 0;
  let approvedNotDeducted = 0;
  for (const a of input.reservedAdvances) {
    const n = toNumber(a.amount);
    if (!Number.isFinite(n)) continue;
    if (a.status === 'Pending') pending += n;
    else if (a.status === 'Approved') approvedNotDeducted += n;
  }
  const reserved = pending + approvedNotDeducted;
  // NOT clamped at zero. `monthlyDeductions` is a NET figure: SSO + recurring
  // deductions + this month's เงินลด, MINUS this month's เงินเพิ่ม. When the
  // Income adjustments win it arrives negative and must widen the cap. A
  // `Math.max(0, …)` here silently discarded that, so an employee handed a
  // bonus saw no extra headroom — see the "net INCOME month" test.
  const deductions = input.monthlyDeductions ?? 0;

  // The floor is POLICY, not entitlement, and the two must not be conflated.
  //
  //   raw < 0  → genuinely overdrawn (reserved exceeds entitlement). Report the
  //              true negative so the UI can say HOW FAR over; the floor is
  //              irrelevant, they already cannot draw.
  //   raw >= 0 → apply the floor, clamped at 0. Never negative: an employee who
  //              owes nothing must not be shown a red "you owe money" state
  //              merely because policy reserves some of their pay.
  //
  // `overdrawn` is therefore computed from RAW on both branches and keeps its
  // original meaning.
  const floor = Math.max(0, toNumber(input.minRemaining) || 0);
  const applyFloor = (raw: number) => (raw < 0 ? raw : Math.max(0, raw - floor));

  if (input.salaryType === 'Monthly') {
    const raw = baseSalary + allowance - deductions - reserved;
    const available = applyFloor(raw);
    return {
      kind: 'monthly',
      baseSalary,
      allowance,
      deductions,
      pending,
      approvedNotDeducted,
      reserved,
      available,
      overdrawn: raw < 0,
    };
  }

  const earnings = input.periodEarnings ?? null;
  // The allowance is a monthly amount, so it is added on top of earnings-so-far
  // rather than scaled by days worked. Null earnings stays null: we cannot say
  // what is left, and an allowance must not turn "unknown" into a number.
  const raw = earnings == null ? null : earnings + allowance - deductions - reserved;
  const available = raw == null ? null : applyFloor(raw);
  return {
    kind: 'rate-based',
    salaryType: input.salaryType,
    ratePerPeriod: baseSalary,
    allowance,
    deductions,
    pending,
    approvedNotDeducted,
    reserved,
    earnings,
    available,
    overdrawn: raw != null && raw < 0,
  };
}
