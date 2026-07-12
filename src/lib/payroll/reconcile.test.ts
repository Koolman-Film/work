import { describe, expect, it } from 'vitest';
import {
  flagRow,
  type PayrollBreakdown,
  severityRank,
  sortFlaggedRows,
  topSeverity,
} from './reconcile';

const zero: PayrollBreakdown = {
  incomeBase: 0,
  incomeOther: 0,
  deductSso: 0,
  deductAdvance: 0,
  deductAttendance: 0,
  deductLeave: 0,
  deductDebt: 0,
  deductOther: 0,
  netPay: 0,
};
const row = (o: Partial<PayrollBreakdown>): PayrollBreakdown => ({ ...zero, ...o });
const base = (o: Partial<PayrollBreakdown> & { month?: string }) => ({
  ...zero,
  ...o,
  month: o.month ?? '2026-05',
});

describe('flagRow', () => {
  it('missing-from-run when current is null but a baseline exists', () => {
    expect(flagRow(null, base({ netPay: 19000 }))).toEqual([{ kind: 'missing-from-run' }]);
  });

  it('no flags when both current and baseline are null', () => {
    expect(flagRow(null, null)).toEqual([]);
  });

  it('net-nonpositive when netPay <= 0', () => {
    const flags = flagRow(row({ incomeBase: 20000, netPay: 0 }), base({ netPay: 19000 }));
    expect(flags).toContainEqual({ kind: 'net-nonpositive' });
  });

  it('low-net when positive net is under 50% of gross', () => {
    const flags = flagRow(row({ incomeBase: 20000, netPay: 9000 }), base({ netPay: 9500 }));
    expect(flags).toContainEqual({ kind: 'low-net' });
  });

  it('does NOT flag low-net at exactly 50% of gross', () => {
    const flags = flagRow(row({ incomeBase: 20000, netPay: 10000 }), base({ netPay: 10000 }));
    expect(flags.some((f) => f.kind === 'low-net')).toBe(false);
  });

  it('new-this-month when there is no baseline', () => {
    const flags = flagRow(row({ incomeBase: 20000, netPay: 19000 }), null);
    expect(flags).toContainEqual({ kind: 'new-this-month' });
    // no swing/deduction flags without a baseline
    expect(flags.some((f) => f.kind === 'net-swing' || f.kind === 'deduction-jump')).toBe(false);
  });

  it('net-swing when |delta| >= 1000 AND >= 20% of baseline', () => {
    const flags = flagRow(row({ incomeBase: 20000, netPay: 12400 }), base({ netPay: 19000 }));
    const swing = flags.find((f) => f.kind === 'net-swing');
    expect(swing).toBeTruthy();
    if (swing?.kind === 'net-swing') {
      expect(swing.deltaAbs).toBe(-6600);
      expect(swing.baselineMonth).toBe('2026-05');
    }
  });

  it('no net-swing when the % is large but absolute < 1000', () => {
    // baseline 800 → current 1500: +700 abs (<1000) even though +87%
    const flags = flagRow(row({ incomeBase: 1500, netPay: 1500 }), base({ netPay: 800 }));
    expect(flags.some((f) => f.kind === 'net-swing')).toBe(false);
  });

  it('no net-swing when absolute is large but < 20% of baseline', () => {
    // baseline 100000 → 98500: -1500 abs (>=1000) but -1.5% (<20%)
    const flags = flagRow(row({ incomeBase: 100000, netPay: 98500 }), base({ netPay: 100000 }));
    expect(flags.some((f) => f.kind === 'net-swing')).toBe(false);
  });

  it('deduction-jump when a component goes 0 -> >0', () => {
    const flags = flagRow(
      row({ incomeBase: 20000, deductAttendance: 500, netPay: 19500 }),
      base({ netPay: 20000 }),
    );
    expect(flags).toContainEqual({
      kind: 'deduction-jump',
      component: 'deductAttendance',
      from: 0,
      to: 500,
    });
  });

  it('deduction-jump when a component rises by >= 2000', () => {
    const flags = flagRow(
      row({ incomeBase: 20000, deductDebt: 3000, netPay: 17000 }),
      base({ deductDebt: 500, netPay: 19500 }),
    );
    expect(flags).toContainEqual({
      kind: 'deduction-jump',
      component: 'deductDebt',
      from: 500,
      to: 3000,
    });
  });

  it('no deduction-jump for a sub-2000 rise on an already-nonzero component', () => {
    const flags = flagRow(
      row({ incomeBase: 20000, deductSso: 750, netPay: 19250 }),
      base({ deductSso: 250, netPay: 19750 }),
    );
    expect(flags.some((f) => f.kind === 'deduction-jump')).toBe(false);
  });
});

describe('severity + sort', () => {
  it('ranks net-nonpositive above deduction-jump', () => {
    expect(severityRank({ kind: 'net-nonpositive' })).toBeLessThan(
      severityRank({ kind: 'deduction-jump', component: 'deductSso', from: 0, to: 5000 }),
    );
  });

  it('topSeverity picks the lowest (most severe) rank across a row', () => {
    expect(
      topSeverity([
        { kind: 'deduction-jump', component: 'deductSso', from: 0, to: 5000 },
        { kind: 'net-nonpositive' },
      ]),
    ).toBe(1);
  });

  it('sorts by top severity, then by descending |netDeltaAbs|', () => {
    const rows = [
      { id: 'a', flags: [{ kind: 'new-this-month' } as const], netDeltaAbs: 0 },
      { id: 'b', flags: [{ kind: 'net-nonpositive' } as const], netDeltaAbs: 100 },
      {
        id: 'c',
        flags: [
          { kind: 'net-swing', deltaAbs: -9000, deltaPct: -0.4, baselineMonth: '2026-05' } as const,
        ],
        netDeltaAbs: 9000,
      },
      {
        id: 'd',
        flags: [
          { kind: 'net-swing', deltaAbs: -3000, deltaPct: -0.2, baselineMonth: '2026-05' } as const,
        ],
        netDeltaAbs: 3000,
      },
    ];
    expect(sortFlaggedRows(rows).map((r) => r.id)).toEqual(['b', 'c', 'd', 'a']);
  });
});
