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
  /** Advance rows where status ∈ {Pending, Approved} AND isDeducted=false. */
  reservedAdvances: ReadonlyArray<{
    status: 'Pending' | 'Approved';
    amount: Prisma.Decimal | string | number;
  }>;
  /** Earned-so-far this payroll period for Daily/Hourly; when provided the
   *  rate-based variant gains available/overdrawn. */
  periodEarnings?: number | null;
  /** Standing monthly deductions to subtract from the cap so an advance can't
   *  exceed NET pay (requirement: "ไม่ให้เบิกเกินเงินเดือนสุทธิ"). Only the
   *  STABLE, always-known deductions belong here — SSO + active recurring
   *  deductions — not the fluctuating attendance/leave/keyed ones. Default 0. */
  monthlyDeductions?: number;
};

export type AdvanceBalance =
  | {
      kind: 'monthly';
      baseSalary: number;
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

  let pending = 0;
  let approvedNotDeducted = 0;
  for (const a of input.reservedAdvances) {
    const n = toNumber(a.amount);
    if (!Number.isFinite(n)) continue;
    if (a.status === 'Pending') pending += n;
    else if (a.status === 'Approved') approvedNotDeducted += n;
  }
  const reserved = pending + approvedNotDeducted;
  const deductions = Math.max(0, input.monthlyDeductions ?? 0);

  if (input.salaryType === 'Monthly') {
    const available = baseSalary - deductions - reserved;
    return {
      kind: 'monthly',
      baseSalary,
      deductions,
      pending,
      approvedNotDeducted,
      reserved,
      available,
      overdrawn: available < 0,
    };
  }

  const earnings = input.periodEarnings ?? null;
  const available = earnings == null ? null : earnings - deductions - reserved;
  return {
    kind: 'rate-based',
    salaryType: input.salaryType,
    ratePerPeriod: baseSalary,
    deductions,
    pending,
    approvedNotDeducted,
    reserved,
    earnings,
    available,
    overdrawn: available != null && available < 0,
  };
}
