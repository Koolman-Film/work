/**
 * Withholding tax (ภาษีหัก ณ ที่จ่าย) in the pure calc.
 *
 * Phase 1 RECORDS tax; it does not compute it. So there is no arithmetic to
 * test here beyond bucketing and the bearer rule — which is exactly why those
 * two need pinning: they are the whole feature.
 */

import { describe, expect, it } from 'vitest';
import { type CalcInput, calcPayroll } from './calc';

const CONFIG = {
  ssoRate: '0.05',
  ssoSalaryCap: '15000',
  ssoAmountCap: '750',
  absentDeductionPerDay: '500',
  lateDeduction: '100',
  earlyLeaveDeduction: '100',
  whtEnabled: true,
};

/** A salaried employee with no attendance events and no SSO — so every number
 *  below is attributable to the adjustments under test and nothing else. */
function input(over: {
  taxBorneByEmployer?: boolean;
  whtEnabled?: boolean;
  adjustments?: CalcInput['adjustments'];
}): CalcInput {
  return {
    month: '2026-06',
    employee: {
      id: 'e1',
      salaryType: 'Monthly',
      baseSalary: '30000',
      hasSso: false,
      taxBorneByEmployer: over.taxBorneByEmployer ?? false,
      allowanceAmount: '0',
    },
    attendances: [],
    advances: [],
    recurringDeductions: [],
    leaveDeductions: [],
    leaveDates: [],
    derivedAbsentDays: 0,
    adjustments: over.adjustments ?? [],
    config: { ...CONFIG, whtEnabled: over.whtEnabled ?? true },
  };
}

describe('withholding tax — bucketing', () => {
  it('sums Tax-kind adjustments into deductTax', () => {
    const d = calcPayroll(input({ adjustments: [{ kind: 'Tax', amount: '1250.50' }] }));
    expect(d.deductTax.toString()).toBe('1250.5');
  });

  it('sums multiple Tax adjustments', () => {
    const d = calcPayroll(
      input({
        adjustments: [
          { kind: 'Tax', amount: '1000' },
          { kind: 'Tax', amount: '250.25' },
        ],
      }),
    );
    expect(d.deductTax.toString()).toBe('1250.25');
  });

  it('keeps Tax out of deductOther, and Deduction out of deductTax', () => {
    const d = calcPayroll(
      input({
        adjustments: [
          { kind: 'Tax', amount: '1000' },
          { kind: 'Deduction', amount: '300' },
        ],
      }),
    );
    // The whole reason Tax is its own kind: ภ.ง.ด.1 must be able to ask what
    // tax was withheld and get a number that is only tax.
    expect(d.deductTax.toString()).toBe('1000');
    expect(d.deductOther.toString()).toBe('300');
  });

  it('is zero when there are no Tax adjustments', () => {
    const d = calcPayroll(input({ adjustments: [{ kind: 'Income', amount: '500' }] }));
    expect(d.deductTax.toString()).toBe('0');
  });

  it('ignores Tax adjustments entirely when whtEnabled is false', () => {
    const d = calcPayroll(
      input({ whtEnabled: false, adjustments: [{ kind: 'Tax', amount: '1250' }] }),
    );
    expect(d.deductTax.toString()).toBe('0');
  });

  it('still applies Income and Deduction adjustments when whtEnabled is false', () => {
    const d = calcPayroll(
      input({
        whtEnabled: false,
        adjustments: [
          { kind: 'Tax', amount: '1250' },
          { kind: 'Deduction', amount: '300' },
          { kind: 'Income', amount: '500' },
        ],
      }),
    );
    // The switch governs tax only. A regression that made it gate the whole
    // adjustment pipeline would be invisible in the tests above.
    expect(d.deductTax.toString()).toBe('0');
    expect(d.deductOther.toString()).toBe('300');
    expect(d.incomeOther.toString()).toBe('500');
  });
});

describe('withholding tax — who bears it', () => {
  it('reduces netPay when the employee bears the tax', () => {
    const d = calcPayroll(
      input({ taxBorneByEmployer: false, adjustments: [{ kind: 'Tax', amount: '1250' }] }),
    );
    expect(d.netPay.toString()).toBe('28750'); // 30000 − 1250
  });

  it('leaves netPay alone when the company bears the tax', () => {
    const d = calcPayroll(
      input({ taxBorneByEmployer: true, adjustments: [{ kind: 'Tax', amount: '1250' }] }),
    );
    expect(d.netPay.toString()).toBe('30000');
  });

  it('records the same deductTax either way', () => {
    const withheld = calcPayroll(
      input({ taxBorneByEmployer: false, adjustments: [{ kind: 'Tax', amount: '1250' }] }),
    );
    const borne = calcPayroll(
      input({ taxBorneByEmployer: true, adjustments: [{ kind: 'Tax', amount: '1250' }] }),
    );
    // deductTax is what was remitted to the RD, not what came off the payslip.
    // ภ.ง.ด.1 reports it in both cases; only take-home differs.
    expect(withheld.deductTax.toString()).toBe('1250');
    expect(borne.deductTax.toString()).toBe('1250');
    expect(withheld.netPay.toString()).not.toBe(borne.netPay.toString());
  });

  it('does not touch netPay when whtEnabled is false, whoever bears it', () => {
    const d = calcPayroll(
      input({
        whtEnabled: false,
        taxBorneByEmployer: false,
        adjustments: [{ kind: 'Tax', amount: '1250' }],
      }),
    );
    expect(d.netPay.toString()).toBe('30000');
  });

  it('stacks with other deductions rather than replacing them', () => {
    const d = calcPayroll(
      input({
        adjustments: [
          { kind: 'Tax', amount: '1250' },
          { kind: 'Deduction', amount: '300' },
        ],
      }),
    );
    expect(d.netPay.toString()).toBe('28450'); // 30000 − 1250 − 300
  });
});
