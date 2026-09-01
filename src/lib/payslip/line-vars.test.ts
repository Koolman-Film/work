import { describe, expect, it } from 'vitest';
import { formatLeaveDates, payslipLineVars } from './line-vars';
import type { PayslipLine } from './types';

const line = (o: Partial<PayslipLine> = {}): PayslipLine => ({
  key: 'k',
  labelKey: 'deduct.leaveItem',
  amount: 450,
  detail: null,
  ...o,
});

describe('formatLeaveDates', () => {
  it('renders a Thai date in the Buddhist year the workforce reads', () => {
    expect(formatLeaveDates({ start: '2026-09-05', end: '2026-09-05' }, 'th')).toBe(
      '5 กันยายน 2569',
    );
  });

  it('names the month rather than numbering it, in every locale', () => {
    // Short dates are 09/05/2026 in en and 05/09/2026 in th/my/km/lo — the same
    // string meaning two different days to two readers of one payslip. This
    // line must never be ambiguous about which day was charged.
    expect(formatLeaveDates({ start: '2026-09-05', end: '2026-09-05' }, 'en')).toBe(
      'September 5, 2026',
    );
    expect(formatLeaveDates({ start: '2026-09-05', end: '2026-09-05' }, 'km')).toBe('5 កញ្ញា 2026');
  });

  it('keeps the calendar day the admin picked, with no timezone shift', () => {
    // @db.Date is UTC midnight and the formatter renders in Asia/Bangkok
    // (UTC+7), so the day must not roll forward across a year boundary.
    expect(formatLeaveDates({ start: '2026-01-01', end: '2026-01-01' }, 'en')).toBe(
      'January 1, 2026',
    );
  });

  it('shows a span for a multi-day request', () => {
    expect(formatLeaveDates({ start: '2026-09-05', end: '2026-09-07' }, 'en')).toBe(
      'September 5, 2026 – September 7, 2026',
    );
  });
});

describe('payslipLineVars', () => {
  it('fills {date} and {leaveType} for an itemised leave line', () => {
    const vars = payslipLineVars(
      line({
        leaveType: { name: 'ลากิจ', nameByLocale: { en: 'Personal leave' } },
        dates: { start: '2026-09-05', end: '2026-09-05' },
      }),
      'en',
    );
    expect(vars).toEqual({ leaveType: 'Personal leave', date: 'September 5, 2026' });
  });

  it('falls back to the canonical Thai name when a locale has no translation', () => {
    const vars = payslipLineVars(
      line({ leaveType: { name: 'ลากิจ', nameByLocale: null }, dates: null }),
      'my',
    );
    expect(vars).toEqual({ leaveType: 'ลากิจ' });
  });

  it('preserves the line own vars alongside the resolved ones', () => {
    const vars = payslipLineVars(
      line({ vars: { days: 2 }, leaveType: { name: 'ลากิจ', nameByLocale: null } }),
      'th',
    );
    expect(vars).toEqual({ days: 2, leaveType: 'ลากิจ' });
  });

  it('passes vars through untouched when there is nothing locale-dependent', () => {
    const l = line({ vars: { count: 3 } });
    expect(payslipLineVars(l, 'th')).toBe(l.vars);
  });
});
