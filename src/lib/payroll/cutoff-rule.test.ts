import { describe, expect, it } from 'vitest';
import {
  type CutoffRule,
  cutoffDayForMonth,
  describeCutoffDay,
  END_OF_MONTH,
  isValidBranchCutoffDay,
  periodContaining,
  periodWindowYmd,
  toRule,
} from './cutoff-rule';

// Central Audio as configured for 2026-10-29: company cuts on the 26th, the
// branch moves to month-end from the October period.
const central: CutoffRule = {
  globalCutoffDay: 26,
  overrides: [{ cutoffDay: END_OF_MONTH, fromMonth: '2026-10' }],
};

function addDay(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

describe('periodWindowYmd — plain number (legacy callers)', () => {
  it('cutoff 26 matches the old 27th→26th window', () => {
    expect(periodWindowYmd('2026-06', 26)).toEqual({ from: '2026-05-27', to: '2026-06-26' });
    expect(periodWindowYmd('2026-01', 26)).toEqual({ from: '2025-12-27', to: '2026-01-26' });
    expect(periodWindowYmd('2026-03', 25)).toEqual({ from: '2026-02-26', to: '2026-03-25' });
  });
});

describe('periodWindowYmd — branch override with effective month', () => {
  it('months before the override keep the company window', () => {
    expect(periodWindowYmd('2026-09', central)).toEqual({ from: '2026-08-27', to: '2026-09-26' });
  });

  it('the transition month is stretched so no day is skipped', () => {
    expect(periodWindowYmd('2026-10', central)).toEqual({ from: '2026-09-27', to: '2026-10-31' });
  });

  it('after the transition, the window is the calendar month', () => {
    expect(periodWindowYmd('2026-11', central)).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(periodWindowYmd('2027-01', central)).toEqual({ from: '2027-01-01', to: '2027-01-31' });
  });

  it('end-of-month clamps to February, including leap years', () => {
    expect(periodWindowYmd('2027-02', central)).toEqual({ from: '2027-02-01', to: '2027-02-28' });
    expect(periodWindowYmd('2028-02', central)).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('a later override applies forward only and never rewrites earlier months', () => {
    const later: CutoffRule = {
      globalCutoffDay: 26,
      overrides: [
        { cutoffDay: 25, fromMonth: '2027-01' },
        { cutoffDay: END_OF_MONTH, fromMonth: '2026-10' },
      ],
    };
    expect(periodWindowYmd('2026-10', later)).toEqual({ from: '2026-09-27', to: '2026-10-31' });
    expect(periodWindowYmd('2026-12', later)).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    // Short month at the switch back — starts the day after December's end.
    expect(periodWindowYmd('2027-01', later)).toEqual({ from: '2027-01-01', to: '2027-01-25' });
    expect(periodWindowYmd('2027-02', later)).toEqual({ from: '2027-01-26', to: '2027-02-25' });
  });

  it('no branch override behaves like the plain number', () => {
    const r: CutoffRule = { globalCutoffDay: 26, overrides: [] };
    expect(periodWindowYmd('2026-10', r)).toEqual(periodWindowYmd('2026-10', 26));
  });
});

describe('periodContaining', () => {
  it('a transition-window date belongs to the stretched month', () => {
    expect(periodContaining('2026-09-28', central)).toEqual({
      start: '2026-09-27',
      end: '2026-10-31',
      month: '2026-10',
    });
    expect(periodContaining('2026-09-26', central).month).toBe('2026-09');
    expect(periodContaining('2026-10-31', central).month).toBe('2026-10');
    expect(periodContaining('2026-11-01', central).month).toBe('2026-11');
  });

  it('matches the legacy cutoff arithmetic for a plain number', () => {
    expect(periodContaining('2026-06-27', 26)).toEqual({
      start: '2026-06-27',
      end: '2026-07-26',
      month: '2026-07',
    });
    expect(periodContaining('2026-12-30', 26).month).toBe('2027-01');
  });

  it('every day from Aug 2026 to Mar 2027 lands in exactly one contiguous window', () => {
    for (const rule of [central, 26] as const) {
      let prevEnd: string | null = null;
      for (let d = '2026-08-01'; d <= '2027-03-31'; d = addDay(d)) {
        const p = periodContaining(d, rule);
        expect(p.start <= d && d <= p.end).toBe(true);
        expect(periodWindowYmd(p.month, rule)).toEqual({ from: p.start, to: p.end });
        if (prevEnd && p.start !== periodContaining(prevEnd, rule).start) {
          expect(p.start).toBe(addDay(prevEnd));
        }
        prevEnd = d;
      }
    }
  });
});

describe('validation', () => {
  it('global cut-off must be 1–28', () => {
    expect(() => toRule(29)).toThrow(/1–28/);
    expect(() => toRule({ globalCutoffDay: 0, overrides: [] })).toThrow(/1–28/);
  });

  it('branch cut-off is 1–28 or end of month', () => {
    expect(isValidBranchCutoffDay(1)).toBe(true);
    expect(isValidBranchCutoffDay(28)).toBe(true);
    expect(isValidBranchCutoffDay(END_OF_MONTH)).toBe(true);
    expect(isValidBranchCutoffDay(29)).toBe(false);
    expect(isValidBranchCutoffDay(30)).toBe(false);
    expect(() =>
      toRule({ globalCutoffDay: 26, overrides: [{ cutoffDay: 30, fromMonth: '2026-10' }] }),
    ).toThrow();
    expect(() =>
      toRule({ globalCutoffDay: 26, overrides: [{ cutoffDay: 31, fromMonth: '2026-1' }] }),
    ).toThrow();
  });

  it('cutoffDayForMonth picks the branch value only from its effective month', () => {
    expect(cutoffDayForMonth('2026-09', central)).toBe(26);
    expect(cutoffDayForMonth('2026-10', central)).toBe(END_OF_MONTH);
  });

  it('describes a cut-off day in Thai', () => {
    expect(describeCutoffDay(END_OF_MONTH)).toBe('สิ้นเดือน');
    expect(describeCutoffDay(26)).toBe('วันที่ 26');
  });
});
