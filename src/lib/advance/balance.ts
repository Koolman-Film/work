/**
 * Salary-balance calculation for the LIFF advance UI.
 *
 * What "available to request" means in this codebase:
 *
 *   available = baseSalary − reserved
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
};

export type AdvanceBalance =
  | {
      kind: 'monthly';
      baseSalary: number;
      pending: number; // sum of Pending advances
      approvedNotDeducted: number; // sum of Approved-but-not-deducted advances
      reserved: number; // pending + approvedNotDeducted
      available: number; // baseSalary - reserved; can go negative if admin over-approves
      overdrawn: boolean; // true when available < 0
    }
  | {
      kind: 'rate-based'; // Daily / Hourly
      salaryType: 'Daily' | 'Hourly';
      ratePerPeriod: number;
      pending: number;
      approvedNotDeducted: number;
      reserved: number;
    };

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

  if (input.salaryType === 'Monthly') {
    const available = baseSalary - reserved;
    return {
      kind: 'monthly',
      baseSalary,
      pending,
      approvedNotDeducted,
      reserved,
      available,
      overdrawn: available < 0,
    };
  }

  return {
    kind: 'rate-based',
    salaryType: input.salaryType,
    ratePerPeriod: baseSalary,
    pending,
    approvedNotDeducted,
    reserved,
  };
}
