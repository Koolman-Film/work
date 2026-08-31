//
// Pure anomaly engine for pre-publish payroll reconciliation. No DB, no I/O —
// the loader (reconcile-data.ts) converts Prisma Decimals to numbers and calls
// flagRow per employee. See docs/superpowers/specs/2026-07-11-payroll-reconciliation-design.md.

export const RECONCILE_THRESHOLDS = {
  swingPct: 0.2,
  swingMin: 1000,
  lowNetPct: 0.5,
  deductionJump: 2000,
} as const;

// The money components of a Payroll row, listed ONCE. Everything below —
// the breakdown type, the gross/deduction sums, the per-component loops — is
// derived from these two arrays, so adding a component is a one-line change
// that the compiler then propagates to every construction site.
//
// This is not hypothetical tidiness. `incomeAllowance` was added to the schema
// and the hand-written gross in `flagRow` kept summing base + other, understating
// it — while the DEDUCTION_COMPONENTS loop ten lines away absorbed its own new
// component without a diff. The list-driven code was already correct; only the
// hand-written arithmetic broke. So: no hand-written sums over these fields.
export const INCOME_COMPONENTS = ['incomeBase', 'incomeAllowance', 'incomeOther'] as const;

export const DEDUCTION_COMPONENTS = [
  'deductSso',
  'deductAdvance',
  'deductAttendance',
  'deductLeave',
  'deductDebt',
  'deductOther',
] as const;

export type IncomeComponent = (typeof INCOME_COMPONENTS)[number];
export type DeductionComponent = (typeof DEDUCTION_COMPONENTS)[number];

export type PayrollBreakdown = Record<IncomeComponent, number> &
  Record<DeductionComponent, number> & { netPay: number };

/** Total earnings before deductions. */
export const grossOf = (b: PayrollBreakdown): number =>
  INCOME_COMPONENTS.reduce((sum, k) => sum + b[k], 0);

/** Everything withheld this month. */
export const deductionsOf = (b: PayrollBreakdown): number =>
  DEDUCTION_COMPONENTS.reduce((sum, k) => sum + b[k], 0);

export type ReconcileFlag =
  | { kind: 'net-nonpositive' }
  | { kind: 'missing-from-run' }
  | { kind: 'low-net' }
  | { kind: 'net-swing'; deltaAbs: number; deltaPct: number; baselineMonth: string }
  | { kind: 'new-this-month' }
  | { kind: 'deduction-jump'; component: DeductionComponent; from: number; to: number };

const SEVERITY: Record<ReconcileFlag['kind'], number> = {
  'net-nonpositive': 1,
  'missing-from-run': 2,
  'low-net': 3,
  'net-swing': 4,
  'new-this-month': 5,
  'deduction-jump': 6,
};

export function severityRank(flag: ReconcileFlag): number {
  return SEVERITY[flag.kind];
}

export function topSeverity(flags: readonly ReconcileFlag[]): number {
  return flags.reduce((min, f) => Math.min(min, severityRank(f)), Number.POSITIVE_INFINITY);
}

/**
 * Flags for one employee. `current` is null when an active employee has no
 * Payroll row this month; `baseline` is null when they have never been paid.
 */
export function flagRow(
  current: PayrollBreakdown | null,
  baseline: (PayrollBreakdown & { month: string }) | null,
  t: typeof RECONCILE_THRESHOLDS = RECONCILE_THRESHOLDS,
): ReconcileFlag[] {
  if (current === null) {
    // Caller only passes active employees; a baseline means they were paid
    // before and have now dropped out of the run.
    return baseline ? [{ kind: 'missing-from-run' }] : [];
  }

  const flags: ReconcileFlag[] = [];
  const gross = grossOf(current);

  if (current.netPay <= 0) flags.push({ kind: 'net-nonpositive' });
  if (gross > 0 && current.netPay > 0 && current.netPay < t.lowNetPct * gross) {
    flags.push({ kind: 'low-net' });
  }

  if (!baseline) {
    flags.push({ kind: 'new-this-month' });
    return flags;
  }

  const deltaAbs = current.netPay - baseline.netPay;
  if (
    Math.abs(deltaAbs) >= t.swingMin &&
    baseline.netPay > 0 &&
    Math.abs(deltaAbs) >= t.swingPct * baseline.netPay
  ) {
    flags.push({
      kind: 'net-swing',
      deltaAbs,
      deltaPct: deltaAbs / baseline.netPay,
      baselineMonth: baseline.month,
    });
  }

  for (const comp of DEDUCTION_COMPONENTS) {
    const from = baseline[comp];
    const to = current[comp];
    if ((from === 0 && to > 0) || to - from >= t.deductionJump) {
      flags.push({ kind: 'deduction-jump', component: comp, from, to });
    }
  }

  return flags;
}

export function sortFlaggedRows<T extends { flags: readonly ReconcileFlag[]; netDeltaAbs: number }>(
  rows: readonly T[],
): T[] {
  return [...rows].sort((a, b) => {
    const sa = topSeverity(a.flags);
    const sb = topSeverity(b.flags);
    if (sa !== sb) return sa - sb;
    return b.netDeltaAbs - a.netDeltaAbs;
  });
}
