import { describe, expect, it } from 'vitest';
import {
  type AccountLookup,
  buildPayrollJournal,
  type PayrollTotals,
  UnbalancedJournalError,
  UnmappedAccountsError,
} from './payroll-journal';

/** Every kind mapped, so a test only has to say what it is testing. */
const ALL: AccountLookup = {
  SalaryExpense: { accountCode: '5100', accountName: 'เงินเดือน' },
  AllowanceExpense: { accountCode: '5110', accountName: 'ค่าครองชีพ' },
  OtherIncomeExpense: { accountCode: '5120', accountName: 'เงินเพิ่มอื่น' },
  SsoEmployerExpense: { accountCode: '5130', accountName: 'เงินสมทบ–นายจ้าง' },
  SsoPayable: { accountCode: '2110', accountName: 'ประกันสังคมค้างจ่าย' },
  AdvanceRecovery: { accountCode: '1150', accountName: 'ลูกหนี้เงินเบิกล่วงหน้า' },
  AttendancePenalty: { accountCode: '4200', accountName: 'รายได้อื่น–ค่าปรับ' },
  LeaveDeduction: { accountCode: '4210', accountName: 'รายได้อื่น–หักลา' },
  DebtRecovery: { accountCode: '1160', accountName: 'ลูกหนี้อื่น' },
  OtherDeduction: { accountCode: '4220', accountName: 'รายได้อื่น' },
  NetPayable: { accountCode: '2100', accountName: 'เงินเดือนค้างจ่าย' },
};

/** A month that balances by construction: net = gross − every deduction. */
function totals(over: Partial<PayrollTotals> = {}): PayrollTotals {
  const base = {
    incomeBase: 10_000_00,
    incomeAllowance: 1_000_00,
    incomeOther: 500_00,
    ssoEmployee: 750_00,
    ssoEmployer: 750_00,
    deductAdvance: 200_00,
    deductAttendance: 100_00,
    deductLeave: 0,
    deductDebt: 0,
    deductOther: 0,
    ...over,
  };
  const gross = base.incomeBase + base.incomeAllowance + base.incomeOther;
  const deductions =
    base.ssoEmployee +
    base.deductAdvance +
    base.deductAttendance +
    base.deductLeave +
    base.deductDebt +
    base.deductOther;
  return { ...base, netPay: gross - deductions };
}

const build = (t: PayrollTotals, accounts: AccountLookup = ALL) =>
  buildPayrollJournal({ month: '2026-09', branchName: 'สำนักงานใหญ่', totals: t, accounts });

describe('the journal balances', () => {
  it('debits equal credits for an ordinary month', () => {
    const j = build(totals());
    expect(j.totalDebit).toBe(j.totalCredit);
  });

  it('signed amounts sum to exactly zero', () => {
    // Integer satang, so this is an exact comparison rather than an epsilon.
    const sum = build(totals()).lines.reduce((n, l) => n + l.amount, 0);
    expect(sum).toBe(0);
  });

  it('still balances when every deduction kind is in play', () => {
    const j = build(totals({ deductLeave: 300_00, deductDebt: 150_00, deductOther: 75_00 }));
    expect(j.totalDebit).toBe(j.totalCredit);
  });

  it('still balances when there are no deductions at all', () => {
    const j = build(
      totals({
        ssoEmployee: 0,
        ssoEmployer: 0,
        deductAdvance: 0,
        deductAttendance: 0,
      }),
    );
    expect(j.totalDebit).toBe(j.totalCredit);
  });

  it('refuses to emit an unbalanced entry rather than exporting one', () => {
    // netPay deliberately wrong by one satang — the shape of a rounding bug.
    const t = { ...totals(), netPay: totals().netPay + 1 };
    expect(() => build(t)).toThrow(UnbalancedJournalError);
  });
});

describe('sides', () => {
  const line = (t: PayrollTotals, kind: string) => build(t).lines.find((l) => l.kind === kind);

  it('puts expenses on the debit side', () => {
    for (const kind of ['SalaryExpense', 'AllowanceExpense', 'SsoEmployerExpense']) {
      expect(line(totals(), kind)?.amount, kind).toBeGreaterThan(0);
    }
  });

  it('puts payables and recoveries on the credit side', () => {
    for (const kind of ['SsoPayable', 'NetPayable', 'AdvanceRecovery']) {
      expect(line(totals(), kind)?.amount, kind).toBeLessThan(0);
    }
  });

  it('books both halves of SSO to one payable', () => {
    // The employee's deduction and the employer's contribution are owed to the
    // same fund — one liability, not two.
    const t = totals({ ssoEmployee: 750_00, ssoEmployer: 750_00 });
    expect(line(t, 'SsoPayable')?.amount).toBe(-1_500_00);
    expect(line(t, 'SsoEmployerExpense')?.amount).toBe(750_00);
  });
});

describe('mapping', () => {
  it('names every unmapped account at once, not the first one', () => {
    const partial: AccountLookup = { ...ALL };
    delete partial.SalaryExpense;
    delete partial.NetPayable;
    try {
      build(totals(), partial);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(UnmappedAccountsError);
      expect((e as UnmappedAccountsError).kinds).toEqual(['SalaryExpense', 'NetPayable']);
    }
  });

  it('does not require an account for a bucket nobody used this month', () => {
    // No leave was deducted, so LeaveDeduction is irrelevant — blocking on it
    // would demand a mapping that cannot change the result.
    const partial: AccountLookup = { ...ALL };
    delete partial.LeaveDeduction;
    expect(() => build(totals({ deductLeave: 0 }), partial)).not.toThrow();
  });

  it('omits zero buckets from the lines entirely', () => {
    const kinds = build(totals({ deductLeave: 0, deductDebt: 0 })).lines.map((l) => l.kind);
    expect(kinds).not.toContain('LeaveDeduction');
    expect(kinds).not.toContain('DebtRecovery');
  });

  it('carries the configured code and label onto the line', () => {
    const l = build(totals()).lines.find((x) => x.kind === 'SalaryExpense');
    expect(l?.accountCode).toBe('5100');
    expect(l?.accountName).toBe('เงินเดือน');
  });
});
