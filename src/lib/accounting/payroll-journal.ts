import type { JournalLineKind } from '@prisma/client';

/**
 * Turns a month of payroll into one double-entry journal.
 *
 * Pure by design: no Prisma, no Decimal, no dates from the clock. Everything
 * this needs arrives as an argument, so the invariant that actually matters —
 * that the entry balances — is provable in a unit test rather than only
 * observable in a downloaded file.
 *
 * Amounts are **signed, debit-positive**. Of the three ways a target can
 * represent debit/credit — two columns, a sign, or a discriminator field — the
 * sign is the only one the other two derive from cleanly. A serialiser can
 * always split a signed number into two columns; it cannot recover the sign
 * from a pair of columns where one is blank without re-deciding which side the
 * line belongs on, and that decision is exactly what this module exists to own.
 *
 * Summarised per month: one entry per branch, one line per account. The
 * per-employee detail lives in the payslips; a general ledger carrying 50 rows
 * per person per month is a ledger nobody reads.
 */

/** Amounts in satang (integer minor units).
 *
 *  Money arrives from Prisma as `Decimal` and leaves as a spreadsheet number.
 *  In between it is an integer, because the one thing a journal must do is sum
 *  to exactly zero, and floating point does not reliably do that: 0.1 + 0.2
 *  is not 0.3. Converting once at the boundary and comparing integers makes
 *  the balance assertion exact instead of approximate. */
export type Satang = number;

export type PayrollTotals = {
  /** Sum of `Payroll.incomeBase` across the month's payrolls. */
  incomeBase: Satang;
  incomeAllowance: Satang;
  incomeOther: Satang;
  /** Employee's own SSO deduction (`Payroll.deductSso`). */
  ssoEmployee: Satang;
  /**
   * Employer's matching contribution. Not stored on `Payroll` — Thai SSO
   * mirrors the employee rate, so the loader passes the same figure. Kept as
   * its own argument rather than derived in here: the day the rates diverge,
   * this signature forces the caller to confront it instead of silently
   * producing a wrong expense.
   */
  ssoEmployer: Satang;
  deductAdvance: Satang;
  deductAttendance: Satang;
  deductLeave: Satang;
  deductDebt: Satang;
  deductOther: Satang;
  netPay: Satang;
};

export type JournalLine = {
  kind: JournalLineKind;
  accountCode: string;
  accountName: string | null;
  /** Debit positive, credit negative. */
  amount: Satang;
};

export type JournalEntry = {
  /** `YYYY-MM` — the payroll month, not the posting date. */
  month: string;
  branchName: string;
  lines: JournalLine[];
  /** Convenience for serialisers that want them separately. */
  totalDebit: Satang;
  totalCredit: Satang;
};

/** `lineKind` → account, as configured per branch. */
export type AccountLookup = Partial<
  Record<JournalLineKind, { accountCode: string; accountName: string | null }>
>;

export class UnmappedAccountsError extends Error {
  constructor(readonly kinds: JournalLineKind[]) {
    super(`ยังไม่ได้ผูกผังบัญชี: ${kinds.join(', ')}`);
    this.name = 'UnmappedAccountsError';
  }
}

export class UnbalancedJournalError extends Error {
  constructor(readonly differenceSatang: number) {
    super(`รายการบัญชีไม่สมดุล ต่างกัน ${differenceSatang} สตางค์`);
    this.name = 'UnbalancedJournalError';
  }
}

/** Debit-positive, credit-negative. Kinds are listed in posting order. */
const SIDE: Record<JournalLineKind, 1 | -1> = {
  SalaryExpense: 1,
  AllowanceExpense: 1,
  OtherIncomeExpense: 1,
  SsoEmployerExpense: 1,
  SsoPayable: -1,
  AdvanceRecovery: -1,
  AttendancePenalty: -1,
  LeaveDeduction: -1,
  DebtRecovery: -1,
  OtherDeduction: -1,
  NetPayable: -1,
};

export function buildPayrollJournal(args: {
  month: string;
  branchName: string;
  totals: PayrollTotals;
  accounts: AccountLookup;
}): JournalEntry {
  const { month, branchName, totals: t, accounts } = args;

  // Gross amounts per kind, before the sign is applied. SSO payable carries
  // BOTH halves: the employee's deduction and the employer's contribution are
  // owed to the same fund, so they are one liability, not two.
  const gross: Array<[JournalLineKind, Satang]> = [
    ['SalaryExpense', t.incomeBase],
    ['AllowanceExpense', t.incomeAllowance],
    ['OtherIncomeExpense', t.incomeOther],
    ['SsoEmployerExpense', t.ssoEmployer],
    ['SsoPayable', t.ssoEmployee + t.ssoEmployer],
    ['AdvanceRecovery', t.deductAdvance],
    ['AttendancePenalty', t.deductAttendance],
    ['LeaveDeduction', t.deductLeave],
    ['DebtRecovery', t.deductDebt],
    ['OtherDeduction', t.deductOther],
    ['NetPayable', t.netPay],
  ];

  // A zero bucket is not a journal line. Requiring an account for a deduction
  // nobody took this month would block the export on a mapping that cannot
  // affect the result.
  const used = gross.filter(([, amount]) => amount !== 0);

  const missing = used.filter(([kind]) => !accounts[kind]).map(([kind]) => kind);
  if (missing.length > 0) throw new UnmappedAccountsError(missing);

  const lines: JournalLine[] = used.map(([kind, amount]) => {
    const account = accounts[kind];
    // Narrowed by the `missing` check above; this keeps TS honest without a cast.
    if (!account) throw new UnmappedAccountsError([kind]);
    return {
      kind,
      accountCode: account.accountCode,
      accountName: account.accountName,
      amount: amount * SIDE[kind],
    };
  });

  const totalDebit = lines.reduce((n, l) => (l.amount > 0 ? n + l.amount : n), 0);
  const totalCredit = lines.reduce((n, l) => (l.amount < 0 ? n - l.amount : n), 0);

  // The one invariant an accountant will never forgive. Exact, because the
  // amounts are integers.
  const difference = totalDebit - totalCredit;
  if (difference !== 0) throw new UnbalancedJournalError(difference);

  return { month, branchName, lines, totalDebit, totalCredit };
}
