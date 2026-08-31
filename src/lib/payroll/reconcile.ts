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

export type DeductionComponent =
  | 'deductSso'
  | 'deductAdvance'
  | 'deductAttendance'
  | 'deductLeave'
  | 'deductDebt'
  | 'deductOther';

export const DEDUCTION_COMPONENTS: readonly DeductionComponent[] = [
  'deductSso',
  'deductAdvance',
  'deductAttendance',
  'deductLeave',
  'deductDebt',
  'deductOther',
];

export type PayrollBreakdown = {
  incomeBase: number;
  incomeAllowance: number;
  incomeOther: number;
  deductSso: number;
  deductAdvance: number;
  deductAttendance: number;
  deductLeave: number;
  deductDebt: number;
  deductOther: number;
  netPay: number;
};

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
  const gross = current.incomeBase + current.incomeAllowance + current.incomeOther;

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
