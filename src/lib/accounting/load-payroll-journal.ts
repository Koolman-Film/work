import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import {
  type AccountLookup,
  buildPayrollJournal,
  type JournalEntry,
  type PayrollTotals,
  type Satang,
  UnbalancedJournalError,
  UnmappedAccountsError,
} from './payroll-journal';

/**
 * The I/O half of the payroll journal: read a month, hand pure numbers to
 * `buildPayrollJournal`. Everything that can be decided without a database
 * lives there and is unit-tested; this file only fetches and converts.
 */

/** Decimal baht → integer satang.
 *
 *  `Decimal.times(100)` on a value already at 2dp is exact, but the round is
 *  kept anyway: `Payroll` columns are `Decimal(12,2)` today and a future
 *  column with more precision would otherwise produce a fractional satang and
 *  a journal that misses balance by a rounding error nobody can see. */
function satang(d: Prisma.Decimal): Satang {
  return d.times(100).toDecimalPlaces(0).toNumber();
}

export type PayrollJournalResult =
  | { ok: true; entry: JournalEntry; payrollCount: number }
  | { ok: false; reason: 'no-branch' }
  | { ok: false; reason: 'no-payrolls' }
  | { ok: false; reason: 'unmapped'; kinds: string[] }
  | { ok: false; reason: 'unbalanced'; differenceSatang: number };

export async function loadPayrollJournal(
  month: string,
  branchId: string,
): Promise<PayrollJournalResult> {
  const [branch, mappings, payrolls] = await Promise.all([
    prisma.branch.findUnique({ where: { id: branchId }, select: { id: true, name: true } }),
    prisma.accountMapping.findMany({
      where: { branchId },
      select: { lineKind: true, accountCode: true, accountName: true },
    }),
    prisma.payroll.findMany({
      // Draft payroll is still being edited; posting it to a ledger would book
      // numbers that are about to change. Only what has been published is a
      // fact about money that moved.
      where: { month, status: 'Published', employee: { branchId } },
      select: {
        incomeBase: true,
        incomeAllowance: true,
        incomeOther: true,
        deductSso: true,
        deductAdvance: true,
        deductAttendance: true,
        deductLeave: true,
        deductDebt: true,
        deductOther: true,
        netPay: true,
      },
    }),
  ]);

  if (!branch) return { ok: false, reason: 'no-branch' };
  if (payrolls.length === 0) return { ok: false, reason: 'no-payrolls' };

  const zero: PayrollTotals = {
    incomeBase: 0,
    incomeAllowance: 0,
    incomeOther: 0,
    ssoEmployee: 0,
    ssoEmployer: 0,
    deductAdvance: 0,
    deductAttendance: 0,
    deductLeave: 0,
    deductDebt: 0,
    deductOther: 0,
    netPay: 0,
  };

  const totals = payrolls.reduce<PayrollTotals>((acc, p) => {
    const sso = satang(p.deductSso);
    return {
      incomeBase: acc.incomeBase + satang(p.incomeBase),
      incomeAllowance: acc.incomeAllowance + satang(p.incomeAllowance),
      incomeOther: acc.incomeOther + satang(p.incomeOther),
      ssoEmployee: acc.ssoEmployee + sso,
      // Thai SSO mirrors the employee rate, and the employer half is not
      // stored on Payroll. Derived HERE, at the boundary, so the pure builder
      // never has to know the rates — and so the day they diverge, this is the
      // single line that changes.
      ssoEmployer: acc.ssoEmployer + sso,
      deductAdvance: acc.deductAdvance + satang(p.deductAdvance),
      deductAttendance: acc.deductAttendance + satang(p.deductAttendance),
      deductLeave: acc.deductLeave + satang(p.deductLeave),
      deductDebt: acc.deductDebt + satang(p.deductDebt),
      deductOther: acc.deductOther + satang(p.deductOther),
      netPay: acc.netPay + satang(p.netPay),
    };
  }, zero);

  const accounts: AccountLookup = Object.fromEntries(
    mappings.map((m) => [m.lineKind, { accountCode: m.accountCode, accountName: m.accountName }]),
  );

  try {
    const entry = buildPayrollJournal({
      month,
      branchName: branch.name,
      totals,
      accounts,
    });
    return { ok: true, entry, payrollCount: payrolls.length };
  } catch (err) {
    if (err instanceof UnmappedAccountsError) {
      return { ok: false, reason: 'unmapped', kinds: err.kinds };
    }
    if (err instanceof UnbalancedJournalError) {
      // Reaching here means payroll's own arithmetic does not reconcile, not
      // that the export is wrong. Surface it rather than emitting a file that
      // would push the discrepancy into someone's books.
      return { ok: false, reason: 'unbalanced', differenceSatang: err.differenceSatang };
    }
    throw err;
  }
}
