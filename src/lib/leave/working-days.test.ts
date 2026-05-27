import { describe, expect, it } from 'vitest';
import { parseInputDate, workingDaysIn } from './working-days';

const d = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

describe('workingDaysIn', () => {
  it('returns a single day when start === end and that day is a working day', () => {
    // 2026-04-29 is a Wednesday.
    const out = workingDaysIn({
      startDate: d('2026-04-29'),
      endDate: d('2026-04-29'),
      holidays: [],
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.toISOString().slice(0, 10)).toBe('2026-04-29');
  });

  it('returns an empty array when start > end (defensive)', () => {
    expect(
      workingDaysIn({
        startDate: d('2026-04-30'),
        endDate: d('2026-04-29'),
        holidays: [],
      }),
    ).toEqual([]);
  });

  it('skips Sundays', () => {
    // 2026-04-26 is a Sunday. Range Sat → Tue should yield 3 days (Sat, Mon, Tue),
    // skipping Sun.
    const out = workingDaysIn({
      startDate: d('2026-04-25'), // Saturday
      endDate: d('2026-04-28'), // Tuesday
      holidays: [],
    });
    expect(out.map((x) => x.toISOString().slice(0, 10))).toEqual([
      '2026-04-25',
      '2026-04-27',
      '2026-04-28',
    ]);
  });

  it('skips holidays even if they fall on a normal working day', () => {
    // 2026-04-13 is a Monday — Songkran in Thailand. Mark it as a holiday;
    // it should be skipped.
    const out = workingDaysIn({
      startDate: d('2026-04-13'),
      endDate: d('2026-04-15'), // Wednesday
      holidays: [d('2026-04-13')],
    });
    expect(out.map((x) => x.toISOString().slice(0, 10))).toEqual(['2026-04-14', '2026-04-15']);
  });

  it('handles a multi-week range correctly (5 weekdays + Saturday per week, no Sundays)', () => {
    // Mon 2026-04-20 through Sat 2026-05-02 inclusive = 13 days raw.
    // Two Sundays in the range (04-26, but only one falls inside Mon-Sat).
    // Wait: 2026-04-20 to 2026-05-02 is 13 days. Sundays in that range:
    // 2026-04-26 only (2026-05-03 falls outside endDate). Expected: 12 days.
    const out = workingDaysIn({
      startDate: d('2026-04-20'),
      endDate: d('2026-05-02'),
      holidays: [],
    });
    expect(out).toHaveLength(12);
    // First and last should be the boundary dates.
    expect(out[0]?.toISOString().slice(0, 10)).toBe('2026-04-20');
    expect(out[out.length - 1]?.toISOString().slice(0, 10)).toBe('2026-05-02');
    // 2026-04-26 (Sunday) should be absent.
    expect(out.some((x) => x.toISOString().slice(0, 10) === '2026-04-26')).toBe(false);
  });

  it('does not double-skip a Sunday that is also a holiday', () => {
    // Idempotent: a Sunday holiday is still just absent once.
    const out = workingDaysIn({
      startDate: d('2026-04-25'),
      endDate: d('2026-04-27'),
      holidays: [d('2026-04-26')],
    });
    expect(out).toHaveLength(2);
  });
});

describe('parseInputDate', () => {
  it('parses a valid YYYY-MM-DD string', () => {
    const out = parseInputDate('2026-04-30');
    expect(out?.toISOString()).toBe('2026-04-30T00:00:00.000Z');
  });

  it('rejects malformed strings', () => {
    expect(parseInputDate('not-a-date')).toBeNull();
    expect(parseInputDate('2026/04/30')).toBeNull();
    expect(parseInputDate('2026-4-30')).toBeNull(); // missing leading zero
    expect(parseInputDate('')).toBeNull();
  });

  it('rejects calendar-impossible dates (Feb 30)', () => {
    // `new Date('2026-02-30')` would roll over to Mar 2. The round-trip
    // check in parseInputDate must catch this.
    expect(parseInputDate('2026-02-30')).toBeNull();
    expect(parseInputDate('2026-13-01')).toBeNull();
    expect(parseInputDate('2026-00-15')).toBeNull();
  });

  it('handles leap-year February correctly', () => {
    // 2028 is a leap year.
    expect(parseInputDate('2028-02-29')?.toISOString().slice(0, 10)).toBe('2028-02-29');
    // 2026 is not — Feb 29 should be rejected.
    expect(parseInputDate('2026-02-29')).toBeNull();
  });
});
