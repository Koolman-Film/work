import { describe, expect, it } from 'vitest';
import { outstandingLeaveInWindow } from './outstanding-in-window';

/**
 * The advance cap needs "how much leave will be deducted from THIS month's pay".
 * `computeLiveLeaveCharges` deliberately has no lower date bound — it remembers
 * the whole backlog so payroll can still collect it — so the cap filters its
 * RESULT rather than its query. Filtering the query would be wrong: the function
 * replays a whole entitlement year in approval order to decide which requests are
 * over quota, so hiding earlier requests would make later ones look under quota.
 */
const charge = (o: Partial<Parameters<typeof outstandingLeaveInWindow>[0][number]> = {}) => ({
  date: '2026-09-05',
  swept: false,
  deductAmount: 500,
  deductedAmountToDate: 0,
  ...o,
});

describe('outstandingLeaveInWindow', () => {
  const from = '2026-08-27';
  const to = '2026-09-26';

  it('sums un-swept charges whose leave date falls inside the window', () => {
    const total = outstandingLeaveInWindow(
      [charge({ date: '2026-09-01', deductAmount: 450 }), charge({ date: '2026-09-20' })],
      from,
      to,
    );
    expect(total).toBe(950);
  });

  it('EXCLUDES backlog from earlier periods — that is the whole point', () => {
    const total = outstandingLeaveInWindow(
      [
        charge({ date: '2026-06-26', deductAmount: 450 }), // 67-day-old backlog
        charge({ date: '2026-07-04', deductAmount: 300 }),
        charge({ date: '2026-09-01', deductAmount: 466.67 }),
      ],
      from,
      to,
    );
    expect(total).toBeCloseTo(466.67, 2);
  });

  it('includes the window boundaries themselves', () => {
    expect(outstandingLeaveInWindow([charge({ date: from })], from, to)).toBe(500);
    expect(outstandingLeaveInWindow([charge({ date: to })], from, to)).toBe(500);
  });

  it('excludes leave dated after the window, even when already approved', () => {
    // ฟิล์ม's real case: approved now, leave dated in a LATER payroll period.
    expect(
      outstandingLeaveInWindow([charge({ date: '2026-10-05', deductAmount: 900 })], from, to),
    ).toBe(0);
  });

  it('ignores charges already swept into a published payroll', () => {
    expect(outstandingLeaveInWindow([charge({ swept: true })], from, to)).toBe(0);
  });

  it('counts only what is still owed when a cap collected part of it', () => {
    const total = outstandingLeaveInWindow(
      [charge({ deductAmount: 1000, deductedAmountToDate: 400 })],
      from,
      to,
    );
    expect(total).toBe(600);
  });

  it('treats a null deductAmount as nothing owed rather than NaN', () => {
    expect(outstandingLeaveInWindow([charge({ deductAmount: null })], from, to)).toBe(0);
  });

  it('never returns a negative total if over-collection ever occurred', () => {
    const total = outstandingLeaveInWindow(
      [charge({ deductAmount: 300, deductedAmountToDate: 500 })],
      from,
      to,
    );
    expect(total).toBe(0);
  });

  it('is zero for an empty list', () => {
    expect(outstandingLeaveInWindow([], from, to)).toBe(0);
  });
});
