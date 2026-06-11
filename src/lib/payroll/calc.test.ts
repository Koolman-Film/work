/**
 * Fixture tests for the pure payroll calc (Phase 2 W6).
 *
 * Goal: 15 distinct cases per the build-plan spec. This file ships the
 * first 8 — the core algebra and the most common shapes Koolman's
 * customer needs. The remaining 7 (mid-month start/end, holiday on
 * weekend, OT crossing midnight, etc.) come as Phase 2 progresses and
 * those features actually land in calc.ts.
 *
 * Reading the assertions:
 *   - `.toString()` is used to compare Decimals to literal numbers
 *     (avoids any floating-point surprise + makes the expected value
 *     visible in test output).
 *   - Cases are numbered to match the build-plan checklist; new ones
 *     should preserve numbering for cross-reference in commit messages.
 */

import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { type AttendanceForPayroll, type CalcInput, calcPayroll, PayrollCalcError } from './calc';

/**
 * Default Thai-labor-law config matching what seed.ts will install
 * in the PayrollConfig table. Tests can spread + override for edge cases.
 */
const DEFAULT_CONFIG = {
  ssoRate: '0.05',
  ssoSalaryCap: '15000',
  ssoAmountCap: '750',
  absentDeductionPerDay: '500',
  lateDeduction: '100',
  earlyLeaveDeduction: '100',
};

function baseInput(overrides: Partial<CalcInput> = {}): CalcInput {
  return {
    employee: {
      id: 'emp-1',
      salaryType: 'Monthly',
      baseSalary: '30000',
    },
    attendances: [],
    advances: [],
    recurringDeductions: [],
    config: DEFAULT_CONFIG,
    month: '2026-05',
    ...overrides,
  };
}

describe('calcPayroll — V1 fixtures', () => {
  // CASE 1: clean full month with no events.
  // Salary 30k → SSO = min(30k*0.05, 750) = min(1500, 750) = 750.
  // Net = 30000 - 750 = 29250.
  it('CASE 1 — clean full month, no events', () => {
    const out = calcPayroll(baseInput());
    expect(out.incomeBase.toString()).toBe('30000');
    expect(out.incomeOther.toString()).toBe('0');
    expect(out.deductSso.toString()).toBe('750');
    expect(out.deductAttendance.toString()).toBe('0');
    expect(out.deductAdvance.toString()).toBe('0');
    expect(out.deductDebt.toString()).toBe('0');
    expect(out.netPay.toString()).toBe('29250');
    expect(out.breakdown).toEqual({ absentCount: 0, lateCount: 0, earlyLeaveCount: 0 });
  });

  // CASE 2: SSO cap-by-rate (low salary).
  // Salary 10k → rate × cappedBase = 0.05 × 10000 = 500 (< 750 amount cap).
  // SSO = 500.
  it('CASE 2 — SSO cap applies via rate when base < 15K', () => {
    const out = calcPayroll(
      baseInput({ employee: { id: 'e', salaryType: 'Monthly', baseSalary: '10000' } }),
    );
    expect(out.deductSso.toString()).toBe('500');
    expect(out.netPay.toString()).toBe('9500');
  });

  // CASE 3: SSO cap-by-amount (high salary).
  // Salary 50k → cappedBase = 15000, rate × cappedBase = 750. Amount cap
  // also 750 → SSO = 750.
  it('CASE 3 — SSO cap applies via amount when base > 15K', () => {
    const out = calcPayroll(
      baseInput({ employee: { id: 'e', salaryType: 'Monthly', baseSalary: '50000' } }),
    );
    expect(out.deductSso.toString()).toBe('750');
    expect(out.netPay.toString()).toBe('49250');
  });

  // CASE 4: 3 absent days.
  // Deduct = 3 × 500 = 1500.
  // Net = 30000 - 750 - 1500 = 27750.
  it('CASE 4 — three absent days', () => {
    const att: AttendanceForPayroll[] = [
      { date: '2026-05-04', type: 'Absent' },
      { date: '2026-05-08', type: 'Absent' },
      { date: '2026-05-15', type: 'Absent' },
    ];
    const out = calcPayroll(baseInput({ attendances: att }));
    expect(out.deductAttendance.toString()).toBe('1500');
    expect(out.breakdown.absentCount).toBe(3);
    expect(out.netPay.toString()).toBe('27750');
  });

  // CASE 5: mix of late + early-leave.
  // 5 lates × 100 + 2 early × 100 = 700.
  it('CASE 5 — mixed late + early-leave rows', () => {
    const att: AttendanceForPayroll[] = [
      ...Array.from(
        { length: 5 },
        (_, i): AttendanceForPayroll => ({
          date: `2026-05-${String(i + 1).padStart(2, '0')}`,
          type: 'Late',
          durationMinutes: 30,
        }),
      ),
      ...Array.from(
        { length: 2 },
        (_, i): AttendanceForPayroll => ({
          date: `2026-05-${String(i + 20).padStart(2, '0')}`,
          type: 'EarlyLeave',
          durationMinutes: 45,
        }),
      ),
    ];
    const out = calcPayroll(baseInput({ attendances: att }));
    expect(out.deductAttendance.toString()).toBe('700');
    expect(out.breakdown).toEqual({ absentCount: 0, lateCount: 5, earlyLeaveCount: 2 });
    expect(out.netPay.toString()).toBe('28550');
  });

  // CASE 6: cash advance offsets the paycheck.
  // 2 advances: 5000 + 3000 = 8000.
  // Net = 30000 - 750 - 8000 = 21250.
  it('CASE 6 — cash advance deduction', () => {
    const out = calcPayroll(
      baseInput({
        advances: [{ amount: '5000' }, { amount: '3000' }],
      }),
    );
    expect(out.deductAdvance.toString()).toBe('8000');
    expect(out.netPay.toString()).toBe('21250');
  });

  // CASE 7: recurring debt (e.g., installment for company laptop).
  // 1500 + 800 = 2300.
  it('CASE 7 — recurring debt deduction', () => {
    const out = calcPayroll(
      baseInput({
        recurringDeductions: [{ monthlyAmount: '1500' }, { monthlyAmount: '800' }],
      }),
    );
    expect(out.deductDebt.toString()).toBe('2300');
    expect(out.netPay.toString()).toBe('26950');
  });

  // CASE 8: combined attendance + advance + debt, the worst case.
  // 30000 - 750(sso) - (2*500+1*100=1100 att) - 4000(adv) - 1500(debt) = 22650.
  it('CASE 8 — combined deductions across all buckets', () => {
    const out = calcPayroll(
      baseInput({
        attendances: [
          { date: '2026-05-05', type: 'Absent' },
          { date: '2026-05-10', type: 'Absent' },
          { date: '2026-05-22', type: 'Late' },
        ],
        advances: [{ amount: '4000' }],
        recurringDeductions: [{ monthlyAmount: '1500' }],
      }),
    );
    expect(out.deductSso.toString()).toBe('750');
    expect(out.deductAttendance.toString()).toBe('1100'); // 2*500 + 1*100
    expect(out.deductAdvance.toString()).toBe('4000');
    expect(out.deductDebt.toString()).toBe('1500');
    expect(out.netPay.toString()).toBe('22650');
  });

  // Type-system guard: Daily/Hourly throw early.
  it('throws PayrollCalcError on Daily salary type', () => {
    expect(() =>
      calcPayroll(baseInput({ employee: { id: 'e', salaryType: 'Daily', baseSalary: '500' } })),
    ).toThrow(PayrollCalcError);
  });

  it('throws PayrollCalcError on Hourly salary type', () => {
    expect(() =>
      calcPayroll(baseInput({ employee: { id: 'e', salaryType: 'Hourly', baseSalary: '100' } })),
    ).toThrow(PayrollCalcError);
  });

  // CASE 9: leave deductions (over-quota leave) are summed into deductLeave
  // and subtracted from netPay.
  // 500.00 + 250 = 750.00 deducted.
  it('CASE 9 — sums leaveDeductions into deductLeave and subtracts from net', () => {
    const baseline = calcPayroll(baseInput());
    const withLeave = calcPayroll(
      baseInput({
        leaveDeductions: [{ amount: '500.00' }, { amount: 250 }],
      }),
    );
    expect(withLeave.deductLeave.toFixed(2)).toBe('750.00');
    // netPay must be exactly 750 less than the baseline (no-leave) draft
    expect(withLeave.netPay.toFixed(2)).toBe(baseline.netPay.minus(new Decimal('750')).toFixed(2));
  });

  // CASE 10: backward compat — omitting leaveDeductions keeps deductLeave=0
  // and netPay identical to the pre-feature baseline.
  it('CASE 10 — omitted leaveDeductions defaults to 0, netPay unchanged', () => {
    const baseline = calcPayroll(baseInput());
    expect(baseline.deductLeave.toFixed(2)).toBe('0.00');
    // Confirm netPay is still the same as CASE 1
    expect(baseline.netPay.toString()).toBe('29250');
  });

  // CASE 11: Income adjustments (เงินเพิ่ม) sum into incomeOther and net.
  // 2000 + 500.50 = 2500.50 extra income.
  // Net = 30000 + 2500.50 - 750 = 31750.50.
  it('CASE 11 — Income adjustments fill incomeOther and add to net', () => {
    const out = calcPayroll(
      baseInput({
        adjustments: [
          { kind: 'Income', amount: '2000' },
          { kind: 'Income', amount: '500.50' },
        ],
      }),
    );
    expect(out.incomeOther.toFixed(2)).toBe('2500.50');
    expect(out.deductOther.toFixed(2)).toBe('0.00');
    expect(out.netPay.toFixed(2)).toBe('31750.50');
  });

  // CASE 12: Deduction adjustments (เงินลด) fill deductOther and subtract.
  // 300 + 199.25 = 499.25.
  // Net = 30000 - 750 - 499.25 = 28750.75.
  it('CASE 12 — Deduction adjustments fill deductOther and subtract from net', () => {
    const out = calcPayroll(
      baseInput({
        adjustments: [
          { kind: 'Deduction', amount: '300' },
          { kind: 'Deduction', amount: '199.25' },
        ],
      }),
    );
    expect(out.incomeOther.toFixed(2)).toBe('0.00');
    expect(out.deductOther.toFixed(2)).toBe('499.25');
    expect(out.netPay.toFixed(2)).toBe('28750.75');
  });

  // CASE 13: mixed Income + Deduction adjustments route to separate buckets.
  it('CASE 13 — mixed adjustments route to incomeOther vs deductOther', () => {
    const out = calcPayroll(
      baseInput({
        adjustments: [
          { kind: 'Income', amount: '1000' },
          { kind: 'Deduction', amount: '400' },
        ],
      }),
    );
    expect(out.incomeOther.toString()).toBe('1000');
    expect(out.deductOther.toString()).toBe('400');
    // 30000 + 1000 - 750 - 400 = 29850
    expect(out.netPay.toString()).toBe('29850');
  });

  // CASE 14: hasSso=false skips the SSO deduction entirely.
  it('CASE 14 — hasSso=false zeroes deductSso', () => {
    const out = calcPayroll(
      baseInput({
        employee: { id: 'e', salaryType: 'Monthly', baseSalary: '30000', hasSso: false },
      }),
    );
    expect(out.deductSso.toString()).toBe('0');
    expect(out.netPay.toString()).toBe('30000');
  });

  // CASE 15: hasSso omitted defaults to true (backward compat — all
  // pre-feature fixtures above rely on this).
  it('CASE 15 — hasSso defaults to true', () => {
    const out = calcPayroll(baseInput());
    expect(out.deductSso.toString()).toBe('750');
  });

  // Decimal-precision sanity — make sure 0.05 × 15000 doesn't drift to
  // 749.9999999... due to floating-point bugs. The whole point of
  // using decimal.js is this case.
  it('SSO rate × salary stays exact (no IEEE-754 drift)', () => {
    const out = calcPayroll(
      baseInput({
        employee: { id: 'e', salaryType: 'Monthly', baseSalary: '15000' },
      }),
    );
    // 0.05 × 15000 = 750.00 exactly
    expect(out.deductSso.toString()).toBe('750');
    expect(out.deductSso.equals(new Decimal('750'))).toBe(true);
  });
});
