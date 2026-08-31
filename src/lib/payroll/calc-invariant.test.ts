/**
 * The payroll identity, asserted in code:
 *
 *   netPay === every income component MINUS every deduction component
 *
 * This is the same rule the `payroll_net_reconciles` CHECK constraint enforces
 * in the database (migration 0045). Both exist because neither alone is enough:
 * the constraint catches a bad row at write time but says nothing until someone
 * runs a payroll, and a unit test catches it in CI but cannot stop a hand-written
 * UPDATE. Together, a component that gets added to the engine and forgotten in
 * the sum fails here first and in Postgres second.
 *
 * Driven off INCOME_COMPONENTS / DEDUCTION_COMPONENTS rather than a hand-written
 * sum, so adding a component to those lists automatically widens this test — a
 * hand-written expectation here would rot exactly the way the production sums
 * did when incomeAllowance landed.
 */

import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { type CalcInput, calcPayroll } from './calc';
import { DEDUCTION_COMPONENTS, INCOME_COMPONENTS } from './reconcile';

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
      hasSso: true,
      allowanceAmount: 0,
    },
    attendances: [],
    advances: [],
    recurringDeductions: [],
    config: DEFAULT_CONFIG,
    month: '2026-05',
    ...overrides,
  };
}

/** Every shape that moves money, so no component is left at 0 across the suite. */
const CASES: { name: string; input: CalcInput }[] = [
  { name: 'clean month', input: baseInput() },
  {
    name: 'allowance only',
    input: baseInput({
      employee: {
        id: 'e',
        salaryType: 'Monthly',
        baseSalary: '25000',
        hasSso: true,
        allowanceAmount: 6000,
      },
    }),
  },
  {
    name: 'allowance + income adjustment + deduct adjustment',
    input: baseInput({
      employee: {
        id: 'e',
        salaryType: 'Monthly',
        baseSalary: '25000',
        hasSso: true,
        allowanceAmount: 6000,
      },
      adjustments: [
        { kind: 'Income', amount: '1500' },
        { kind: 'Deduction', amount: '450' },
      ],
    }),
  },
  {
    name: 'allowance-heavy, small base, no SSO',
    input: baseInput({
      employee: {
        id: 'e',
        salaryType: 'Monthly',
        baseSalary: '5000',
        hasSso: false,
        allowanceAmount: 20000,
      },
    }),
  },
  {
    name: 'advance + leave + recurring deductions',
    input: baseInput({
      advances: [{ amount: '3000' }, { amount: '500' }],
      recurringDeductions: [{ monthlyAmount: '1200' }],
      leaveDeductions: [{ amount: '800' }, { amount: '250.50' }],
    }),
  },
  {
    name: 'satang precision — amounts that do not divide evenly',
    input: baseInput({
      employee: {
        id: 'e',
        salaryType: 'Monthly',
        baseSalary: '13333.33',
        hasSso: true,
        allowanceAmount: '1666.67',
      },
      adjustments: [{ kind: 'Income', amount: '0.01' }],
      leaveDeductions: [{ amount: '0.99' }],
    }),
  },
];

describe('calcPayroll — net always reconciles with its components', () => {
  for (const { name, input } of CASES) {
    it(name, () => {
      const out = calcPayroll(input);

      const income = INCOME_COMPONENTS.reduce((sum, k) => sum.plus(out[k]), new Decimal(0));
      const deducted = DEDUCTION_COMPONENTS.reduce((sum, k) => sum.plus(out[k]), new Decimal(0));

      // .toString() so a mismatch prints the actual satang, not "false".
      expect(out.netPay.toString()).toBe(income.minus(deducted).toString());
    });
  }

  it('covers every component — no case leaves one silently at zero', () => {
    const touched = new Set<string>();
    for (const { input } of CASES) {
      const out = calcPayroll(input);
      for (const k of [...INCOME_COMPONENTS, ...DEDUCTION_COMPONENTS]) {
        if (!out[k].isZero()) touched.add(k);
      }
    }
    // deductAttendance needs attendance rows, which these fixtures deliberately
    // omit — calc.test.ts covers it. Everything else must be exercised here, or
    // the reconciliation above proves less than it appears to.
    const expected = [...INCOME_COMPONENTS, ...DEDUCTION_COMPONENTS].filter(
      (k) => k !== 'deductAttendance',
    );
    expect([...touched].sort()).toEqual([...expected].sort());
  });
});
